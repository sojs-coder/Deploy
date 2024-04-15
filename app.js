const express = require("express");
const { createInstance, createInstanceAndLoad } = require("./instance");
const app = express.Router();
const multer = require("multer");
const {fs, deleteFile} = require("./fs_utils");
const { addToken, getToken } = require("./image_token_manager");
const { s3 } = require("./aws");
const { deploy } = require("./docker_utils");
function assignID(req,res,next){
  req.clientID = Math.random().toString(36).substring(2, 15);
  return next();
}
const storage = multer.diskStorage({
  destination: function (req, file, cb) {

    // Define the directory where you want to store the uploaded files
    fs.mkdirSync(`projects/resources/${req.clientID}`,{ recursive: true })
    cb(null, `projects/${req.clientID}`);
  },
  filename: function (req, file, cb) {
    cb(null, file.originalname);
  }
});

const upload = multer({ storage: storage });


app.get("/", (req, res) => {
  res.send("hello world");
});

app.get("/initialize.sh", (req, res) => {
  res.sendFile(__dirname + "/bash_scripts/initialize.sh");
});
app.get("/image/:imageID",async (req,res)=>{

  // var token = req.query.token;
  // if(!token) return res.status(401).send("No token provided");
  // var row = await getToken(req.params.imageID);
  // if(!row || row.token != token) return res.status(401).send("Token incorrect");
  // if(row.expiresAt <= new Date().getTime()) return res.status(401).send("Token expired");

  var filePath = await deploy.pullAndSave(req.params.imageID);
  res.status(200).sendFile(__dirname+"/"+filePath,(err)=>{
    deleteFile(filePath);
  })

})
app.get("/build/static",(req,res)=>{
  res.send(`<form action = "../create/${req.query.region || "us-west-1"}/${req.query.type || "t2.micro"}" method = "post" enctype="multipart/form-data">
  <input type = "file" name = "files" id = "files" directory webkitdirectory mozdirectory=/>
  <input type = "submit" value = "Create Instance">
  </form>`)
});
app.post("/create/:region/:type",assignID, upload.array("files"), async (req, res) => {
  const { region, type } = req.params;
  try {
    var x = await createInstanceAndLoad(type, region, req.clientID);
    res.status(200).send(x);
  } catch (err) {
    res.status(500).send(err);
  }
});

module.exports = { app };
