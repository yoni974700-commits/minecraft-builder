const express = require("express");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");
const AdmZip = require("adm-zip");

const app = express();

const upload = multer({
  dest: "/tmp/uploads",
  limits: {
    fileSize: 50 * 1024 * 1024
  }
});

app.get("/", (req, res) => {
  res.send("Minecraft Maven Builder is ONLINE!");
});

app.post("/build", upload.single("project"), (req, res) => {
  if (!req.file) {
    return res.status(400).json({
      success: false,
      error: "Missing ZIP file"
    });
  }

  const id = Date.now().toString();
  const dir = `/tmp/build-${id}`;

  try {
    fs.mkdirSync(dir, { recursive: true });

    const zip = new AdmZip(req.file.path);
    zip.extractAllTo(dir, true);

    console.log("Starting Maven build...");

    execFile(
      "mvn",
      ["clean", "package", "-DskipTests"],
      {
        cwd: dir,
        timeout: 300000,
        maxBuffer: 10 * 1024 * 1024
      },
      (error, stdout, stderr) => {
        if (error) {
          console.error("Maven build failed:");
          console.error("MAVEN ERROR:", stderr);
          console.error("MAVEN OUTPUT:", stdout);


          fs.rmSync(dir, { recursive: true, force: true });
          fs.rmSync(req.file.path, { force: true });

          return res.status(400).json({
            success: false,
            error: stderr || stdout || error.message
          });
        }

        console.log("Maven build completed!");

        const target = path.join(dir, "target");

        if (!fs.existsSync(target)) {
          fs.rmSync(dir, { recursive: true, force: true });
          fs.rmSync(req.file.path, { force: true });

          return res.status(400).json({
            success: false,
            error: "Maven finished but target folder was not found"
          });
        }

        const jars = fs
          .readdirSync(target)
          .filter(
            file =>
              file.endsWith(".jar") &&
              !file.endsWith("-sources.jar") &&
              !file.endsWith("-javadoc.jar")
          );

        if (jars.length === 0) {
          fs.rmSync(dir, { recursive: true, force: true });
          fs.rmSync(req.file.path, { force: true });

          return res.status(400).json({
            success: false,
            error: "Maven finished but no JAR was produced",
            output: stdout
          });
        }

        const jarPath = path.join(target, jars[0]);

        console.log(`JAR created: ${jars[0]}`);

        res.download(jarPath, jars[0], err => {
          fs.rmSync(dir, { recursive: true, force: true });
          fs.rmSync(req.file.path, { force: true });

          if (err) {
            console.error("Download error:", err);
          }
        });
      }
    );
  } catch (error) {
    console.error(error);

    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }

    if (req.file && fs.existsSync(req.file.path)) {
      fs.rmSync(req.file.path, { force: true });
    }

    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

const PORT = process.env.PORT || 8080;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});
