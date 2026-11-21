// Adds the app icon, Android adaptive icon, notification icon and splash screen to both phone apps' app.json.
// It edits the files in place, so your Expo project ID (added by `eas init`) is kept. Safe to run twice.
const fs = require("fs");
const path = require("path");

const apps = [
  { dir: "mobile", background: "#FFFFFF" },
  { dir: "admin-mobile", background: "#0E7F74" },
];

for (const app of apps) {
  const file = path.join(__dirname, "..", app.dir, "app.json");
  const json = JSON.parse(fs.readFileSync(file, "utf8"));
  const expo = json.expo;
  expo.icon = "./assets/icon.png";
  expo.android = {
    ...expo.android,
    adaptiveIcon: {
      foregroundImage: "./assets/adaptive-icon.png",
      monochromeImage: "./assets/adaptive-icon-mono.png",
      backgroundColor: app.background,
    },
  };
  const keep = (expo.plugins || []).filter((p) => !["expo-notifications", "expo-splash-screen"].includes(Array.isArray(p) ? p[0] : p));
  expo.plugins = [
    ...keep,
    ["expo-notifications", { icon: "./assets/notification-icon.png", color: "#0E7F74" }],
    ["expo-splash-screen", { image: "./assets/splash-icon.png", imageWidth: 200, resizeMode: "contain", backgroundColor: app.background }],
  ];
  fs.writeFileSync(file, JSON.stringify(json, null, 2) + "\n");
  console.log(`Updated ${app.dir}/app.json`);
}
