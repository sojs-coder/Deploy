const { mkDir, writeStream, fs } = require("./fs_utils");
const { exec } = require("child_process");
const {s3} = require("./aws")
function fromNGINX(projectClass, projectID) {
  switch (projectClass) {
    case "static":
      staticNGINX(projectID);
  }
}
function staticNGINX(projectID) {
  console.log("Building static NGINX project...");
  const dockerFile = writeStream(`projects/${projectID}/Dockerfile`);
  dockerFile.write(`FROM nginx\n`);
  dockerFile.write(`COPY ./resources /usr/share/nginx/html\n`);
  dockerFile.write(`EXPOSE 80\n`);
  dockerFile.write(`CMD ["nginx", "-g", "daemon off;"]`);
  dockerFile.end();

  exec(`docker build -t ${projectID} -o type=tar,dest=docker_images/${projectID}.tar ./projects/${projectID}`, (err, stdout, stderr) => {
    if (err) {
      console.error(`Error building Docker image: ${err}`);
      return;
    }
    console.log(`Docker image built successfully: ${projectID}`);
    const imageStream = fs.createReadStream(`docker_images/${projectID}.tar`);
    const params = {
      Bucket: "deploystorage",
      Key: `images/${projectID}.tar`,
      Body: imageStream
    };
    console.log("Uploading image")
    s3.upload(params, (err, data) => {
      if (err) {
        console.error(`Error uploading image to S3: ${err}`);
        return;
      }
      console.log(`Image uploaded to S3: ${data.Location}`);

      // Delete local Docker image
      console.log("deleting local image")
      fs.unlink(`docker_images/${projectID}.tar`,(err)=>{
        if(err) console.error(err);
	console.log("Local image deleted successfully");
      });
    })
  })
}


fromNGINX("static", "pid_1");

