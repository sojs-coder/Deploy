const sqlite = require("sqlite3");
const db = new sqlite.Database("database/tokens.db")

db.run(`CREATE TABLE if NOT EXISTS tokens (
    tokenID INTEGER PRIMARY KEY AUTOINCREMENT,
    imageID TEXT,
    token TEXT,
    expiresAt NUMBER
)`)
function getToken(image){
    return new Promise((resolve,reject)=>{
        db.get(`SELECT * FROM tokens WHERE imageID = ?`, image, (err,row)=>{
            if(err) reject(err);
            resolve(row)
        })
    })
}
function addToken(image,token){
    return new Promise((resolve,reject)=>{
        db.run(`INSERT INTO tokens (imageID, token, expiresAt) VALUES (?, ?, ?)`,[image, token, new Date().getTime() + 1000 * 60 * 60],(err)=>{
            if(err) reject(err);
            resolve();
        });
    })
}

function removeExpiredTokens(){
    return new Promise((resolve,reject)=>{
        var rn = new Date().getTime();
        db.run(`DELETE FROM tokens WHERE expiresAt <= ?`,rn,(err)=>{
            if(err) reject(err);
            resolve();
        })
    })
}
function getAllTokens(){
    return new Promise((resolve,reject)=>{
        db.all(`SELECT * FROM tokens`,(err,rows)=>{
            if(err) reject(err);
            resolve(rows);
        })
    })
}

removeExpiredTokens().then(()=>{
    console.log("@ removeExpiredTokens: tokens removed")
})
setInterval(async () => {
    await removeExpiredTokens();
    console.log("setInterval -> removeExpiredTokensExpired: tokens removed");
}, 1000*60*60);

module.exports = {
    addToken,
    getToken,
    getAllTokens
}