const fs = require("fs");
const { exec } = require("child_process");
const { Client } = require("ssh2");


// Function to fetch the latest Ubuntu AMI ID
async function getLatestUbuntuAMI(region) {
  try {
    const ssm = new AWS.SSM({ region });
    const parameter = await ssm
      .getParameter({
        Name: "/aws/service/canonical/ubuntu/server/20.04/stable/current/amd64/hvm/ebs-gp2/ami-id",
      })
      .promise();
    return parameter.Parameter.Value;
  } catch (err) {
    console.error("Error fetching Ubuntu AMI:", err);
    throw err;
  }
}

async function createKeyPair(ec2, id, s3) {
  try {
    const params = {
      KeyName: "dep_kp_" + id,
    };

    const data = await ec2.createKeyPair(params).promise();
    console.log("Key pair created:", data.KeyName);

    // Save private key material to a local file
    const privateKeyFilePath = `dep_kp_${id}.pem`;
    fs.writeFileSync(privateKeyFilePath, data.KeyMaterial);

    // Upload private key to S3
    const s3Params = {
      Bucket: "deplystorage",
      Key: `keyPairs/${params.KeyName}.pem`,
      Body: fs.createReadStream(privateKeyFilePath),
    };

    await s3.upload(s3Params).promise();
    console.log(
      `Private key uploaded to S3 bucket 'deploykps' with key ${s3Params.Key}`,
    );

    // Clean up local private key file
    fs.unlinkSync(privateKeyFilePath);
    console.log(`Local private key file ${privateKeyFilePath} deleted.`);

    return data.KeyName; // Return the key pair name
  } catch (err) {
    console.error("Error creating key pair and uploading:", err);
    throw err;
  }
}

// Function to create a new security group
async function createSecurityGroup(ec2, id) {
  try {
    const params = {
      Description: "Deploy-Created Security Group", // Specify a description for your security group
      GroupName: "dep_sg_" + id, // Specify a name for your security group
    };

    const data = await ec2.createSecurityGroup(params).promise();
    console.log("Security group created:", data.GroupId);
    return data.GroupId; // Return the ID of the security group
  } catch (err) {
    console.error("Error creating security group:", err);
    throw err;
  }
}

// Function to authorize inbound traffic to the security group
async function authorizeSecurityGroupIngress(ec2, groupId) {
  try {
    const params = {
      GroupId: groupId,
      IpPermissions: [
        {
          IpProtocol: "tcp",
          FromPort: 22, // SSH
          ToPort: 22,
          IpRanges: [{ CidrIp: "0.0.0.0/0" }], // Allow SSH access from anywhere
        },
      ],
    };

    await ec2.authorizeSecurityGroupIngress(params).promise();
    console.log("Ingress rule added to security group.");
  } catch (err) {
    console.error("Error authorizing ingress:", err);
    throw err;
  }
}
async function getAvailableZones(ec2, region) {
  try {
    const data = await ec2.describeAvailabilityZones().promise();
    const zones = data.AvailabilityZones.map((zone) => zone.ZoneName);
    return zones;
  } catch (err) {
    console.error("Error getting available zones:", err);
    throw err;
  }
}
function waitForInstanceRunning(ec2, instanceId) {
  const params = {
    InstanceIds: [instanceId],
  };

  return new Promise((resolve, reject) => {
    ec2.waitFor("instanceRunning", params, (err, data) => {
      if (err) {
        reject(err);
      } else {
        resolve(data);
      }
    });
  });
}
function chmod600(filePath) {
  return new Promise((resolve, reject) => {
    fs.chmod(filePath, 0o600, (err) => {
      if (err) {
        reject(err);
      } else {
        console.log("Permissions set to 600 successfully for", filePath);
        resolve(true);
      }
    });
  });
}
function runCommand(connSettings, command, pemFilePath, triesLeft = 5) {
  const conn = new Client();
  conn
    .on("ready", () => {
      console.log("SSH connection established");

      conn.exec(command, (err, stream) => {
        if (err) throw err;
        stream
          .on("close", (code, signal) => {
            console.log("Stream closed");
            fs.unlink(pemFilePath, (err) =>{
              if(err) console.error(err);
              console.log("Local private key file deleted.");
            })
            conn.end();
          })
          .on("data", (data) => {
            console.log("STDOUT: " + data);
          })
          .stderr.on("data", (data) => {
            console.log("STDERR: " + data);
          });
      });
    })
    .connect(connSettings);

  conn.on("error", (err) => {
    console.log("Error: ", err);
    console.log(
      `Attempting reconnection in 5 seconds... (${triesLeft} attempts left)`,
    );
    setTimeout(() => {
      runCommand(connSettings, command,pemFilePath, triesLeft - 1);
    }, 5000);
  });
}
async function executeCommandOnInstance(ec2, s3, instanceId, command) {
  console.log(
    `Starting command execution on instance ${instanceId}\n\n\`${command}\``,
  );
  // Retrieve instance details
  const params = {
    InstanceIds: [instanceId],
  };

  try {
    const data = await ec2.describeInstances(params).promise();

    if (!data.Reservations.length) {
      console.error("Instance not found.");
      return;
    }

    const instance = data.Reservations[0].Instances[0];
    const publicIpAddress = instance.PublicIpAddress;
    if (!publicIpAddress) {
      console.error("Instance does not have a public IP address.");
      return;
    }
    console.log(`Found public IP ${publicIpAddress}`);
    const name = instance.Tags.find((tag) => tag.Key === "Name").Value;
    const uid = "dep_kp_" + name.split("_")[2];
    // Download PEM file from S3
    const pemFilePath = `dep_kp_${name.split("_")[2]}.pem`;
    const pemFile = fs.createWriteStream(pemFilePath);
    const s3Params = {
      Bucket: "deploykps",
      Key: `keyPairs/${pemFilePath}`,
    };

    await s3
      .getObject(s3Params)
      .promise()
      .then((data) => {
        pemFile.write(data.Body);
        pemFile.end();
        console.log(
          `PEM file downloaded from S3 bucket 'deploykps' with key ${s3Params.Key}`,
        );
        // modify permissions of the file to 600
        chmod600(pemFilePath).then(() => {
          const connSettings = {
            host: publicIpAddress,
            port: 22, // Standard SSH port
            username: "ubuntu",
            privateKey: require("fs").readFileSync(pemFilePath),
          };
          runCommand(connSettings, command, pemFilePath);
        });
      })
      .catch((err) => {
        console.error("Error downloading PEM file:", err);
        return;
      });
  } catch (err) {
    console.error("Error connecting to instance:", err);
  }
}
// Function to create an EC2 instance
async function createInstance(instanceType, location) {
  AWS.config.update({ region: location });
  var ec2 = new AWS.EC2({ region: location });
  var s3 = new AWS.S3({ region: location });
  try {
    // creat an ID
    var id = Math.random().toString(36).substring(2, 15);
    // Create a new key pair
    const keyName = await createKeyPair(ec2, id, s3);

    // Create a new security group
    const securityGroupId = await createSecurityGroup(ec2, id);

    // Authorize inbound traffic to the security group
    await authorizeSecurityGroupIngress(ec2, securityGroupId);

    // Get the latest Ubuntu AMI ID
    const amiId = await getLatestUbuntuAMI(location);
    const tags = [
      {
        Key: "Name",
        Value: "dep_i_" + id,
      },
    ];
    const availableLocations = await getAvailableZones(ec2, location);
    const realLoc = availableLocations[0];
    const params = {
      ImageId: amiId, // Use the latest Ubuntu AMI ID
      InstanceType: instanceType,
      MinCount: 1,
      MaxCount: 1,
      KeyName: keyName, // Use the key pair name created earlier
      SecurityGroupIds: [securityGroupId],
      Placement: {
        AvailabilityZone: realLoc,
      },
      TagSpecifications: [
        {
          ResourceType: "instance",
          Tags: tags,
        },
      ],
    };
    const data = await ec2.runInstances(params).promise();
    var instanceID = data.Instances[0].InstanceId;
    console.log("Instance created:", instanceID);
    waitForInstanceRunning(ec2, instanceID).then((data) => {
      console.log("Instance is running:", instanceID);
      console.log("sending test command `echo 'hello world' > ~/test.txt`");
        executeCommandOnInstance(
        ec2,
        s3,
        instanceID,
        "wget xxxx/t.sh && yes | bash t.sh",
      );
    });
    return {
      instanceID,
      id
    }
  } catch (err) {
    console.error("Error creating instance:", err);
    return null;
  }
}

// Example usage
module.exports = {
  createInstance,
  executeCommandOnInstance
}