const express = require("express");
const cors = require("cors");

const app = express();

app.use(cors());

app.use(express.json());

app.get("/api/health", (req,res) => {
  res.json({ok:true, service:"panel-callcenter-web", time:new Date().toISOString()});
});

app.post("/api/auth/login", (req,res) => {
  res.status(501).json({
    error:"not_implemented",
    note:"Aquí conectaremos LDAP (Samba AD) en el siguiente paso."
  });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`panel-callcenter-web listening on port ${PORT}`);
});
