const { mkDir, writeStream, fs } = require("./fs_utils");
const { exec } = require("child_process");
const { s3, ecr } = require("./aws");
const { addToken } = require("./image_token_manager");
const { deploy } = require("./docker_utils")
async function fromNGINX(projectClass, projectID) {
  var token = "";
  switch (projectClass) {
    case "static":
      token = await staticNGINX(projectID);
  }
  return token;
}
async function staticNGINX(projectID) {
    console.log("@ staticNGINX: Building static NGINX project...");

    // Create Dockerfile
    const dockerFile = fs.createWriteStream(`projects/${projectID}/Dockerfile`);
    dockerFile.write(`FROM nginx:alpine\n`);
    dockerFile.write(`COPY ./resources /usr/share/nginx/html\n`);
    dockerFile.write(`EXPOSE 80\n`);
    dockerFile.write(`CMD ["nginx", "-g", "daemon off;"]`);
    dockerFile.end();

    await deploy.build(projectID);
    console.log(`@ staticNGINX: Docker image built successfully: ${projectID}`);
    // Tag Docker image
    await deploy.tag(projectID);
    await deploy.login()
    await deploy.push(projectID)
    console.log(`@ staticNGINX: Image pushed to ECR: 708504602187.dkr.ecr.us-west-1.amazonaws.com/deploy:${projectID}`);
    await deploy.save(projectID)
    console.log('@ staticNGINX: Docker images saved');
    var token = Math.random().toString(36).substring(2, 15);
    await addToken(projectID, token);
    console.log("@ staticNGINX: token:", token)
    return token
}


module.exports = {
  fromNGINX
}

