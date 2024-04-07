const express = require("express");
const { createInstance } = require("./instance");
const app = express.Router();

app.get("/", (req, res) => {
  res.send("hello world");
});

app.get("/t.sh", (req, res) => {
  res.sendFile(__dirname + "/bash_scripts/docker_i.sh");
});
app.get("")
app.get("/create/:region/:type", async (req, res) => {
  const { region, type } = req.params;
  try {
    var x = await createInstance(type, region);
    res.status(200).send(x);
  } catch (err) {
    res.status(500).send(err);
  }
});

module.exports = { app };
