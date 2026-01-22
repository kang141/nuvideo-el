const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const bgDir = path.join(process.cwd(), "public", "backgrounds");

if (!fs.existsSync(bgDir)) {
  console.error("Background directory not found:", bgDir);
  process.exit(1);
}

const categories = fs
  .readdirSync(bgDir)
  .filter((f) => fs.statSync(path.join(bgDir, f)).isDirectory());

console.log("Starting thumbnail generation in:", bgDir);

categories.forEach((category) => {
  const categoryDir = path.join(bgDir, category);
  const thumbDir = path.join(categoryDir, "thumbnails");

  if (!fs.existsSync(thumbDir)) {
    console.log(`Creating thumbnails directory for ${category}...`);
    fs.mkdirSync(thumbDir);
  }

  const files = fs
    .readdirSync(categoryDir)
    .filter(
      (f) =>
        f.toLowerCase().endsWith(".jpg") || f.toLowerCase().endsWith(".png"),
    );

  files.forEach((file) => {
    const inputPath = path.join(categoryDir, file);
    const outputPath = path.join(thumbDir, file);

    // Check if thumbnail already exists
    if (fs.existsSync(outputPath)) return;

    try {
      console.log(`Generating thumbnail for ${category}/${file}...`);
      // Use ffmpeg to resize and compress
      // -vf "scale=320:-1" resizes to width 320 maintaining aspect ratio
      // -q:v 10 sets quality (lower is better, 5-10 is good for thumbs)
      execSync(
        `ffmpeg -i "${inputPath}" -vf "scale=320:-1" -q:v 10 "${outputPath}" -y`,
        { stdio: "ignore" },
      );
    } catch (err) {
      console.error(`Failed to generate thumbnail for ${file}:`, err.message);
    }
  });
});

console.log("Thumbnail generation complete!");
