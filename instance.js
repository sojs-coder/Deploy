const fs = require("fs");
const { exec } = require("child_process");
const { Client } = require("ssh2");
const { fromNGINX } = require("./generate_docker");
const { AWS, upload } = require("./aws")
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

async function createKeyPair(ec2, id) {
  try {
    const params = {
      KeyName: "dep_kp_" + id,
    };

    const data = await ec2.createKeyPair(params).promise();
    console.log("@ createKeyPair: Key pair created:", data.KeyName);

    // Save private key material to a local file
    const privateKeyFilePath = `temp_kp/dep_kp_${id}.pem`;
    fs.writeFileSync(privateKeyFilePath, data.KeyMaterial);


    await upload(`keyPairs/${params.KeyName}.pem`,privateKeyFilePath)
    console.log(
      `@ createKeyPair: Private key uploaded to S3 bucket 'deploystorage'`,
    );

    // Clean up local private key file
    fs.unlinkSync(privateKeyFilePath);
    console.log(`@ createKeyPair: Local private key file ${privateKeyFilePath} deleted.`);

    return data.KeyName; // Return the key pair name
  } catch (err) {
    console.error("@ createKeyPair: Error creating key pair and uploading:", err);
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
    console.log("@ createSecurityGroup: Security group created:", data.GroupId);
    return data.GroupId; // Return the ID of the security group
  } catch (err) {
    console.error("@ createSecurityGroup: Error creating security group:", err);
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
          IpRanges: [{ CidrIp: "54.151.56.210/32" }] // Allow SSH access from 54.151.56.210
        },
        {
          IpProtocol: "tcp",
          FromPort: 80, // HTTP
          ToPort: 80,
          IpRanges: [{ CidrIp: "0.0.0.0/0" }] // Allow HTTP access from anywhere
        },
        {
          IpProtocol: "tcp",
          FromPort: 443, // HTTPS
          ToPort: 443,
          IpRanges: [{ CidrIp: "0.0.0.0/0" }] // Allow HTTPS access from anywhere
        }
      ]
    };
    

    await ec2.authorizeSecurityGroupIngress(params).promise();
    console.log("@ authorizeSecurityGroupIngress: Ingress rule added to security group.");
  } catch (err) {
    console.error("@ authorizeSecurityGroupIngress: Error authorizing ingress:", err);
    throw err;
  }
}
async function getAvailableZones(ec2, region) {
  try {
    const data = await ec2.describeAvailabilityZones().promise();
    const zones = data.AvailabilityZones.map((zone) => zone.ZoneName);
    return zones;
  } catch (err) {
    console.error("@ getAvailableZones: Error getting available zones:", err);
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
        console.log("@ chmod600: Permissions set to 600 successfully for", filePath);
        resolve(true);
      }
    });
  });
}
function runCommand(connSettings, command, pemFilePath, triesLeft = 5) {
  const conn = new Client();
  conn
    .on("ready", () => {
      console.log("@ runCommand: SSH connection established");

      conn.exec(command, (err, stream) => {
        if (err) throw err;
        stream
          .on("close", (code, signal) => {
            console.log("@ runCommand -> conn.exec -> stream.close: Stream closed");
            fs.unlink("temp_kp/"+pemFilePath, (err) =>{
              if(err) console.error(err);
              console.log("@ runCommand -> conn.exec -> stream.close -> fs.unlink: runCommand: Local private key file deleted.");
            });
            conn.end();
            console.log("@ runnCommand -> conn.exec -> stream.close -> conn.end: connection closed")
          })
          .on("data", (data) => {
            console.log("@ runCommand -> conn.exec -> stream.data: runCommand: STDOUT: " + data);
          })
          .stderr.on("data", (data) => {
            console.log("@ runCommand -> conn.exec -> stderr.data: STDERR: " + data);
          });
      });
    })
    .connect(connSettings);

  conn.on("error", (err) => {
    console.log("@ runCommand -> conn.error: Error: ", err);
    console.log(
      `@ runCommand -> conn.error: Attempting reconnection in 5 seconds... (${triesLeft} attempts left)`,
    );
    setTimeout(() => {
      runCommand(connSettings, command,pemFilePath, triesLeft - 1);
    }, 5000);
  });
}
async function executeCommandOnInstance(ec2, s3, instanceId, command) {
  console.log(
    `@ executeCommandOnInstance: Starting command execution on instance ${instanceId}\n\n\`${command}\``,
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
    console.log(`@ executeCommandOnInstance Found public IP ${publicIpAddress}`);
    const name = instance.Tags.find((tag) => tag.Key === "Name").Value;
    const uid = "dep_kp_" + name.split("_")[2];
    // Download PEM file from S3
    const pemFilePath = `dep_kp_${name.split("_")[2]}.pem`;
    const pemFile = fs.createWriteStream("temp_kp/"+pemFilePath);
    const s3Params = {
      Bucket: "deploystorage",
      Key: `keyPairs/${pemFilePath}`,
    };

    await s3
      .getObject(s3Params)
      .promise()
      .then((data) => {
        pemFile.write(data.Body);
        pemFile.end();
        console.log(
          `@ executeCommandOnInstance: PEM file downloaded from S3 bucket 'deploystorage' with key ${s3Params.Key}`,
        );
        // modify permissions of the file to 600
        chmod600("temp_kp/"+pemFilePath).then(() => {
          const connSettings = {
            host: publicIpAddress,
            port: 22, // Standard SSH port
            username: "ubuntu",
            privateKey: require("fs").readFileSync("temp_kp/"+pemFilePath),
          };
          waitForInstanceRunning(ec2,instanceId).then(()=>{
            runCommand(connSettings, command, pemFilePath);
          })
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
async function createInstance(instanceType, location,id) {
  AWS.config.update({ region: location });
  var ec2 = new AWS.EC2({ region: location });
  try {
    // creat an ID
    // Create a new key pair
    const keyName = await createKeyPair(ec2, id);

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
    console.log("@ createInstance: Instance created:", instanceID);
    return {
      instanceID,
      id
    }
  } catch (err) {
    console.error("Error creating instance:", err);
    return null;
  }
}
async function createInstanceAndLoad(region, type, id){
  console.log("@ createInstanceAndLoad: creating", { region, type, id});
  // create instance
  var { instanceID } = await createInstance(type,region, id);
  // generate image
  var token = await fromNGINX("static",id);
  //console.log("TOKEN", token, "ID", id)

  // install and run script
  executeCommandOnInstance(new AWS.EC2({ region }),new AWS.S3(), instanceID, `wget -O install.sh http://deploy.sojs.dev/initialize.sh && sudo bash install.sh ${id} ${token}`);
}

createInstanceAndLoad("us-west-1","t2.micro","test10");
// createInstance("t2.nano","us-west-1","test_creating_instance_4")
// Example usage
module.exports = {
  createInstance,
  executeCommandOnInstance
}