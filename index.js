require("dotenv").config();
const { app: routes } = require("./app");


const express = require('express');

const app = express();

app.use(routes);

app.listen(3000, () => {
  console.log('server started');
});