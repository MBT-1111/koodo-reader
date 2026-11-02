async function backgroundFile(page) {
  const dataUrl = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 240;
    canvas.height = 360;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#edf2df";
    ctx.fillRect(0, 0, 240, 360);
    ctx.fillStyle = "#c2d8cb";
    for (let y = 0; y < 360; y += 60) ctx.fillRect(0, y, 240, 20);
    return canvas.toDataURL("image/png");
  });
  return { name: "koodo-background-device.png", mimeType: "image/png", buffer: Buffer.from(dataUrl.split(",")[1], "base64") };
}

async function openBackgrounds(page) {
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Background", exact: true }).click();
}

module.exports = { backgroundFile, openBackgrounds };
