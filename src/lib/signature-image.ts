import { EMPLOYEE_DOCUMENT_MAX_BYTES } from "@/lib/employee-documents-config";

function canvasToPng(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((result) => {
      if (result) resolve(result);
      else reject(new Error("Could not create a transparent PNG."));
    }, "image/png");
  });
}

export async function processSignature(file: File) {
  const image = await createImageBitmap(file);
  try {
    const scale = Math.min(1, 1400 / Math.max(image.width, image.height));
    const width = Math.max(1, Math.round(image.width * scale));
    const height = Math.max(1, Math.round(image.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("Could not process the signature image.");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);
    const data = context.getImageData(0, 0, width, height).data;
    const total = width * height;

    const luminance = new Uint8Array(total);
    const histogram = new Uint32Array(256);
    for (let index = 0; index < total; index += 1) {
      const offset = index * 4;
      const value = Math.round(
        data[offset] * 0.299 +
          data[offset + 1] * 0.587 +
          data[offset + 2] * 0.114,
      );
      luminance[index] = value;
      histogram[value] += 1;
    }

    const target = Math.max(5, Math.floor(total * 0.0005));
    let darkest = 0;
    let accumulated = 0;
    for (let value = 0; value < 256; value += 1) {
      accumulated += histogram[value];
      if (accumulated >= target) {
        darkest = value;
        break;
      }
    }
    if (darkest > 150)
      throw new Error(
        "Signature ink not found. Upload a clearer photo with dark pen ink.",
      );

    const range = 255 - darkest;
    const strongMaximum = darkest + range * 0.3;
    const alphaFull = darkest + range * 0.18;
    const alphaZero = darkest + range * 0.5;

    let inkRed = 0;
    let inkGreen = 0;
    let inkBlue = 0;
    let inkCount = 0;
    for (let index = 0; index < total; index += 1) {
      if (luminance[index] <= alphaFull) {
        const offset = index * 4;
        inkRed += data[offset];
        inkGreen += data[offset + 1];
        inkBlue += data[offset + 2];
        inkCount += 1;
      }
    }
    if (!inkCount) throw new Error("Signature ink could not be detected.");
    inkRed = Math.round(inkRed / inkCount);
    inkGreen = Math.round(inkGreen / inkCount);
    inkBlue = Math.round(inkBlue / inkCount);

    const cellSize = Math.max(3, Math.round(Math.max(width, height) / 150));
    const gridWidth = Math.ceil(width / cellSize);
    const gridHeight = Math.ceil(height / cellSize);
    const cellInk = new Uint32Array(gridWidth * gridHeight);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        if (luminance[y * width + x] <= strongMaximum) {
          cellInk[
            Math.floor(y / cellSize) * gridWidth +
              Math.floor(x / cellSize)
          ] += 1;
        }
      }
    }

    const labels = new Int32Array(gridWidth * gridHeight).fill(-1);
    const componentInk: number[] = [];
    const reach = 3;
    for (let start = 0; start < cellInk.length; start += 1) {
      if (!cellInk[start] || labels[start] !== -1) continue;
      const id = componentInk.length;
      let sum = 0;
      const stack = [start];
      labels[start] = id;
      while (stack.length) {
        const current = stack.pop() as number;
        sum += cellInk[current];
        const cx = current % gridWidth;
        const cy = Math.floor(current / gridWidth);
        for (let dy = -reach; dy <= reach; dy += 1) {
          for (let dx = -reach; dx <= reach; dx += 1) {
            const nx = cx + dx;
            const ny = cy + dy;
            if (nx < 0 || ny < 0 || nx >= gridWidth || ny >= gridHeight)
              continue;
            const next = ny * gridWidth + nx;
            if (!cellInk[next] || labels[next] !== -1) continue;
            labels[next] = id;
            stack.push(next);
          }
        }
      }
      componentInk.push(sum);
    }
    if (!componentInk.length)
      throw new Error(
        "The signature ink could not be detected. Upload a clearer image.",
      );

    const biggest = Math.max(...componentInk);
    const keep = componentInk.map((sum) => sum >= biggest * 0.12);
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        if (luminance[y * width + x] > strongMaximum) continue;
        const id =
          labels[
            Math.floor(y / cellSize) * gridWidth + Math.floor(x / cellSize)
          ];
        if (id < 0 || !keep[id]) continue;
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
    }
    if (maxX <= minX || maxY <= minY)
      throw new Error(
        "The signature ink could not be detected. Upload a clearer image.",
      );

    const paddingX = Math.max(6, Math.round((maxX - minX + 1) * 0.04));
    const paddingY = Math.max(6, Math.round((maxY - minY + 1) * 0.08));
    const cropX = Math.max(0, minX - paddingX);
    const cropY = Math.max(0, minY - paddingY);
    const cropWidth = Math.min(
      width - cropX,
      maxX - minX + 1 + paddingX * 2,
    );
    const cropHeight = Math.min(
      height - cropY,
      maxY - minY + 1 + paddingY * 2,
    );

    const output = new ImageData(cropWidth, cropHeight);
    for (let y = 0; y < cropHeight; y += 1) {
      for (let x = 0; x < cropWidth; x += 1) {
        const sourceX = x + cropX;
        const sourceY = y + cropY;
        const id =
          labels[
            Math.floor(sourceY / cellSize) * gridWidth +
              Math.floor(sourceX / cellSize)
          ];
        if (id < 0 || !keep[id]) continue;
        const value = luminance[sourceY * width + sourceX];
        let alpha = ((alphaZero - value) / (alphaZero - alphaFull)) * 255;
        alpha = Math.max(0, Math.min(255, alpha));
        if (alpha < 30) continue;
        const targetIndex = (y * cropWidth + x) * 4;
        output.data[targetIndex] = inkRed;
        output.data[targetIndex + 1] = inkGreen;
        output.data[targetIndex + 2] = inkBlue;
        output.data[targetIndex + 3] = alpha;
      }
    }

    const resultCanvas = document.createElement("canvas");
    resultCanvas.width = cropWidth;
    resultCanvas.height = cropHeight;
    const resultContext = resultCanvas.getContext("2d");
    if (!resultContext)
      throw new Error("Could not create the signature image.");
    resultContext.putImageData(output, 0, 0);
    const blob = await canvasToPng(resultCanvas);
    if (blob.size > EMPLOYEE_DOCUMENT_MAX_BYTES)
      throw new Error("The processed signature image exceeds the 3 MB limit.");
    const baseName = file.name.replace(/\.[^.]+$/, "") || "signature";
    return new File([blob], `${baseName}-transparent.png`, {
      type: "image/png",
      lastModified: file.lastModified,
    });
  } finally {
    image.close();
  }
}

export async function rotateSignature(file: File, degrees: number) {
  const image = await createImageBitmap(file);
  try {
    const radians = (degrees * Math.PI) / 180;
    const sin = Math.abs(Math.sin(radians));
    const cos = Math.abs(Math.cos(radians));
    const width = Math.ceil(image.width * cos + image.height * sin);
    const height = Math.ceil(image.width * sin + image.height * cos);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("Could not rotate the signature.");
    context.translate(width / 2, height / 2);
    context.rotate(radians);
    context.drawImage(image, -image.width / 2, -image.height / 2);

    const pixels = context.getImageData(0, 0, width, height);
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        if (pixels.data[(y * width + x) * 4 + 3] <= 20) continue;
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
    }
    if (maxX <= minX || maxY <= minY)
      throw new Error("The rotated signature has no visible pixels.");
    const padX = Math.max(6, Math.round((maxX - minX + 1) * 0.04));
    const padY = Math.max(6, Math.round((maxY - minY + 1) * 0.08));
    const cropX = Math.max(0, minX - padX);
    const cropY = Math.max(0, minY - padY);
    const cropWidth = Math.min(width - cropX, maxX - minX + 1 + padX * 2);
    const cropHeight = Math.min(height - cropY, maxY - minY + 1 + padY * 2);
    const output = document.createElement("canvas");
    output.width = cropWidth;
    output.height = cropHeight;
    const outputContext = output.getContext("2d");
    if (!outputContext)
      throw new Error("Could not create the rotated signature.");
    outputContext.drawImage(
      canvas,
      cropX,
      cropY,
      cropWidth,
      cropHeight,
      0,
      0,
      cropWidth,
      cropHeight,
    );
    const blob = await canvasToPng(output);
    return new File([blob], file.name, {
      type: "image/png",
      lastModified: file.lastModified,
    });
  } finally {
    image.close();
  }
}
