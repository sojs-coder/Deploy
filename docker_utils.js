var docker = require("dockerode");
const { promisify } = require('util');
const exec = promisify(require('child_process').exec);
const { ecr } = require("./aws");
const {deleteFile} = require("./fs_utils");
class Registry{
    constructor(name="deploy"){
        this.name = name;
    }
    async login(){
        console.log("@ Registry.login: Logging in to registry...")
        var authToken = await this.getAuthToken();
        return await exec(`docker login -u AWS -p ${authToken} 708504602187.dkr.ecr.us-west-1.amazonaws.com`);
    }
    async build(imageID){
        console.log("@ Registry.build: Building image")
        return await exec(`docker build -t ${imageID} ./projects/${imageID}`)
    }
    async clean(imageID){
        console.log("@ Registry.clean: cleaning image", imageID)
        return await exec(`docker rmi ${imageID}:latest 708504602187.dkr.ecr.us-west-1.amazonaws.com/deploy:${imageID}`)
    }
    async rmi(imageID,tag="latest"){
        console.log("@ Registry.rmi: removing image",tag)
        return await exec(`docker rmi ${imageID}:${tag}`);
    }
    async tag(imageID){
        console.log("@ Registry.tag: tagging image..")
        return await exec(`docker tag ${imageID}:latest  708504602187.dkr.ecr.us-west-1.amazonaws.com/deploy:${imageID}`)
    }
    async push(imageID){
        // assuming built
        console.log("@ Registry.push: pushing image")
        return await exec(`docker push 708504602187.dkr.ecr.us-west-1.amazonaws.com/deploy:${imageID}`)
    }
    async save(imageID){
        // assuming pulled
        console.log("@ Registry.save: saving image")

        return await exec(`docker save -o ./docker_images/${imageID} 708504602187.dkr.ecr.us-west-1.amazonaws.com/deploy:${imageID}`)
    }
    async pull(imageID){
        console.log("@ Registry.pull: pulling image")
        return await exec(`docker pull 708504602187.dkr.ecr.us-west-1.amazonaws.com/deploy:${imageID}`)
    }
    async cleanSave(imageID){
        console.log("@ Registry.cleanSave: cleaning templ image")

        return await deleteFile(`docker_images/${imageID}`);
    }
    async pullAndSave(imageID){
        console.log("@ Registry.pullAndSave...... pulling, saving, cleaning ", imageID)
        await this.pull(imageID);
        await this.save(imageID);
        await this.rmi(`708504602187.dkr.ecr.us-west-1.amazonaws.com/deploy`,imageID);
        return `docker_images/${imageID}`;
    }
    getAuthToken(){
        console.log("@ Registry.getAuthToken")
        return new Promise((resolve,reject)=>{
            ecr.getAuthorizationToken({},(err,data)=>{
                console.log("@ Registry.getAuthToken-> ECR.getAuthorizationToken: gathered output")
                if(err){
                    console.log("@ Registry.getAuthToken-> ECR.getAuthorizationToken: error",err)
                    reject(err);
                }
                console.log("@ Registry.getAuthToken-> ECR.getAuthorizationToken: Success");
                const authToken = Buffer.from(data.authorizationData[0].authorizationToken, 'base64').toString('ascii').split(':')[1];
                console.log("@ Registry.getAuthToken-> ECR.getAuthorizationToken: got token")
                resolve(authToken)
            })
        })

    }
}

var deploy = new Registry();

// deploy.pullAndSave("test1")
module.exports = { Registry, deploy }