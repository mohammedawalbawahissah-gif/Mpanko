// Adds web-address app links to app.json. Set EXPO_PUBLIC_WEB_URL (for example https://shop.example.com) when you build,
// and publish the matching files from the web build (see docs/APP-LINKS.md). Without it the app still opens mpanko:// links.
module.exports = ({ config }) => {
  const url = process.env.EXPO_PUBLIC_WEB_URL;
  if (!url) return config;
  const host = new URL(url).host;
  return {
    ...config,
    ios: { ...config.ios, associatedDomains: [`applinks:${host}`] },
    android: {
      ...config.android,
      intentFilters: [
        {
          action: "VIEW",
          autoVerify: true,
          data: [{ scheme: "https", host, pathPrefix: "/shop" }, { scheme: "https", host, pathPrefix: "/orders" }, { scheme: "https", host, pathPrefix: "/support" }],
          category: ["BROWSABLE", "DEFAULT"],
        },
      ],
    },
  };
};
