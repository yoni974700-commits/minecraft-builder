const express = require("express");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execFile } = require("child_process");
const AdmZip = require("adm-zip");

const app = express();

const upload = multer({
  dest: "/tmp/uploads",
  limits: {
    fileSize: 50 * 1024 * 1024
  }
});

const downloads = new Map();

function findPom(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isFile() && entry.name === "pom.xml") {
      return path.dirname(fullPath);
    }

    if (entry.isDirectory()) {
      const found = findPom(fullPath);
      if (found) return found;
    }
  }

  return null;
}

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

    console.log("ZIP extracted.");

    const projectDir = findPom(dir);

    if (!projectDir) {
      fs.rmSync(dir, { recursive: true, force: true });
      fs.rmSync(req.file.path, { force: true });

      return res.status(400).json({
        success: false,
        error: "No pom.xml found inside the ZIP."
      });
    }

    console.log(`Found Maven project: ${projectDir}`);
    console.log("Starting Maven build...");

    execFile(
      "mvn",
      ["clean", "package", "-DskipTests"],
      {
        cwd: projectDir,
        timeout: 300000,
        maxBuffer: 20 * 1024 * 1024
      },
      (error, stdout, stderr) => {
        if (error) {
          console.error("MAVEN ERROR:");
          console.error(stderr);

          console.error("MAVEN OUTPUT:");
          console.error(stdout);

          fs.rmSync(dir, { recursive: true, force: true });
          fs.rmSync(req.file.path, { force: true });

          return res.status(400).json({
            success: false,
            error: stderr || stdout || error.message
          });
        }

        console.log("Maven build completed!");

        const target = path.join(projectDir, "target");

        if (!fs.existsSync(target)) {
          fs.rmSync(dir, { recursive: true, force: true });
          fs.rmSync(req.file.path, { force: true });

          return res.status(400).json({
            success: false,
            error: "Target folder was not found."
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
            error: "No JAR was produced.",
            output: stdout
          });
        }

        const jarName = jars[0];
        const jarPath = path.join(target, jarName);

        const downloadId = crypto.randomBytes(24).toString("hex");

        downloads.set(downloadId, {
          path: jarPath,
          name: jarName,
          createdAt: Date.now(),
          buildDir: dir,
          uploadPath: req.file.path
        });

        const baseUrl = `${req.protocol}://${req.get("host")}`;
        const downloadUrl = `${baseUrl}/download/${downloadId}`;

        console.log(`JAR created: ${jarName}`);
        console.log(`Download URL: ${downloadUrl}`);

        return res.json({
          success: true,
          fileName: jarName,
          downloadUrl: downloadUrl
        });
      }
    );
  } catch (error) {
    console.error("Server error:", error);

    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }

    if (req.file && fs.existsSync(req.file.path)) {
      fs.rmSync(req.file.path, { force: true });
    }

    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.get("/download/:id", (req, res) => {
  const file = downloads.get(req.params.id);

  if (!file) {
    return res.status(404).send("Download expired or not found.");
  }

  if (!fs.existsSync(file.path)) {
    downloads.delete(req.params.id);
    return res.status(404).send("File no longer exists.");
  }

  res.download(file.path, file.name, error => {
    if (error) {
      console.error("Download error:", error);
    }

    try {
      if (fs.existsSync(file.buildDir)) {
        fs.rmSync(file.buildDir, { recursive: true, force: true });
      }

      if (fs.existsSync(file.uploadPath)) {
        fs.rmSync(file.uploadPath, { force: true });
      }
    } catch (cleanupError) {
      console.error("Cleanup error:", cleanupError);
    }

    downloads.delete(req.params.id);
  });
});

const PORT = process.env.PORT || 8080;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});
