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
module.exports = {
  mkDir,
  writeStream,
  fs
}