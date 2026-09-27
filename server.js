const express = require("express");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");
const AdmZip = require("adm-zip");

const app = express();
const upload = multer({ dest: "/tmp/uploads" });

app.post("/build", upload.single("project"), async (req, res) => {
  if (!req.file) return res.status(400).send("Missing ZIP");

  const id = Date.now().toString();
  const dir = `/tmp/build-${id}`;

  try {
    fs.mkdirSync(dir, { recursive: true });

    const zip = new AdmZip(req.file.path);
    zip.extractAllTo(dir, true);

    execFile("mvn", ["clean", "package", "-DskipTests"], {
      cwd: dir,
      timeout: 120000
    }, (error, stdout, stderr) => {
      if (error) {
        console.error(stderr);
        return res.status(400).json({
          success: false,
          error: stderr || stdout
        });
      }

      const target = path.join(dir, "target");
      const jars = fs.readdirSync(target)
        .filter(f => f.endsWith(".jar") && !f.endsWith("-sources.jar"));

      if (!jars.length) {
        return res.status(400).json({
          success: false,
          error: "No JAR was produced"
        });
      }

      res.download(path.join(target, jars[0]), jars[0], () => {
        fs.rmSync(dir, { recursive: true, force: true });
        fs.rmSync(req.file.path, { force: true });
      });
    });
  } catch (e) {
    res.status(500).json({
      success: false,
      error: e.message
    });
  }
});

app.get("/", (_, res) => {
  res.send("Minecraft Maven Builder is running!");
});

app.listen(process.env.PORT || 3000, "0.0.0.0");
