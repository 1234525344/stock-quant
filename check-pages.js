const http = require("http");
http.get("http://localhost:9222/json", (res) => {
  let data = "";
  res.on("data", c => data += c);
  res.on("end", () => {
    JSON.parse(data).forEach(p => {
      console.log(p.id.substring(0,8) + " | " + (p.title || "").substring(0,50) + " | " + (p.url || "").substring(0,100));
    });
  });
}).on("error", () => console.log("CDP not running"));
