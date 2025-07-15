import https from "https";

interface PackageInfo {
  "dist-tags": {
    latest: string;
  };
}

export function getPackageInfo(packageName: string): Promise<PackageInfo> {
  return new Promise((resolve, reject) => {
    const url = `https://registry.npmjs.org/${packageName}`;

    const req = https.get(
      url,
      { headers: { "User-Agent": "VSCode-PatchPulse-Extension" } },
      (res: any) => {
        let data = "";
        res.on("data", (chunk: any) => (data += chunk));
        res.on("end", () => {
          try {
            resolve(JSON.parse(data));
          } catch (error) {
            reject(error);
          }
        });
      }
    );

    req.on("error", reject);
  });
}
