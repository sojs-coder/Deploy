const fs = require("fs");

function mkDir(path){
  return new Promise((resolve,reject)=>{
    fs.mkdir(path, (err)=>{
      if(err) return reject(err);
      resolve(true);
    })
  })
}
function writeStream(path){
  return fs.createWriteStream(path);
}
function deleteFile(path){
  return new Promise((resolve,reject)=>{
    fs.unlink(path,(err)=>{
      if(err) return reject(err);
      resolve();
    })
  })
}
module.exports = {
  mkDir,
  writeStream,
  deleteFile,
  fs,
}