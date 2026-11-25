export function downloadTermsPdf(papers: HTMLElement[], filename: string) {
  if (!papers.length) throw new Error("Terms pages are not available to download.");

  const printWindow = window.open("", "_blank");
  if (!printWindow) throw new Error("Allow pop-ups to save the PDF.");

  const stylesheets = Array.from(
    document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]'),
  )
    .map((stylesheet) => stylesheet.outerHTML)
    .join("");
  const styleTags = Array.from(document.querySelectorAll("style"))
    .map((style) => style.outerHTML)
    .join("");
  const pageMarkup = papers
    .map((paper, index) => {
      const clone = paper.cloneNode(true) as HTMLElement;
      clone.style.width = "794px";
      clone.style.margin = "0 auto";
      clone.style.boxShadow = "none";
      clone.style.borderRadius = "0";
      clone.style.background = "#ffffff";
      clone.style.color = "#111111";
      clone.style.breakAfter = index < papers.length - 1 ? "page" : "auto";
      clone.style.pageBreakAfter =
        index < papers.length - 1 ? "always" : "auto";
      return clone.outerHTML;
    })
    .join("");

  const printStyles = `
    @page { size: A4 portrait; margin: 0; }
    html, body { margin: 0 !important; padding: 0 !important; }
    .terms-export-root { width: 794px; margin: 0 auto; }
    .terms-export-root .terms-paper {
      width: 794px !important;
      box-sizing: border-box;
      box-shadow: none !important;
    }
    @media print {
      .terms-export-root .terms-paper { break-inside: avoid; }
    }
  `;
  const readyToPrint = new Promise<void>((resolve, reject) => {
    printWindow.addEventListener(
      "load",
      () => {
        void (async () => {
          await printWindow.document.fonts.ready;
          const images = Array.from(printWindow.document.images);
          await Promise.all(images.map((image) => image.decode()));
          printWindow.focus();
          printWindow.print();
          resolve();
        })().catch((error: unknown) => {
          printWindow.close();
          reject(
            error instanceof Error
              ? error
              : new Error("Could not prepare the PDF for printing."),
          );
        });
      },
      { once: true },
    );
    printWindow.onafterprint = () => printWindow.close();
  });
  printWindow.document.open();
  printWindow.document.write(`<!doctype html>
    <html>
      <head>
        <meta charset="utf-8">
        <base href="${document.location.origin}/">
        <title>${escapeHtml(filename.replace(/\\.pdf$/i, ""))}</title>
        ${stylesheets}
        ${styleTags}
        <style>${printStyles}</style>
      </head>
      <body><main class="terms-export-root">${pageMarkup}</main></body>
    </html>`);
  printWindow.document.close();
  return readyToPrint;
}

export async function downloadTermsWord(
  papers: HTMLElement[],
  filename: string,
) {
  if (!papers.length) throw new Error("Terms pages are not available to download.");

  const clones = papers.map((paper) => {
    const clone = paper.cloneNode(true) as HTMLElement;
    copyComputedStyles(paper, clone);
    clone.style.width = "794px";
    clone.style.display = "block";
    clone.style.margin = "0 auto";
    clone.style.boxShadow = "none";
    clone.style.borderRadius = "0";
    clone.style.background = "#ffffff";
    clone.style.color = "#111111";
    clone.querySelectorAll<HTMLElement>("*").forEach((element) => {
      element.style.color = "#111111";
    });
    const colorBar = clone.querySelector<HTMLElement>(
      ".terms-letterfoot > [aria-hidden='true']",
    );
    if (colorBar) {
      colorBar.style.background = "transparent";
      colorBar.innerHTML = `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;height:14px"><tr>
        <td bgcolor="#169a3c" style="background-color:#169a3c;height:14px;font-size:1px;line-height:1px">&nbsp;</td>
        <td bgcolor="#fbc45c" style="background-color:#fbc45c;height:14px;font-size:1px;line-height:1px">&nbsp;</td>
        <td bgcolor="#dc2f1f" style="background-color:#dc2f1f;height:14px;font-size:1px;line-height:1px">&nbsp;</td>
      </tr></table>`;
    }
    return clone;
  });

  await Promise.all(
    clones.flatMap((clone) =>
      Array.from(clone.querySelectorAll("img")).map(async (image) => {
        if (image.src.startsWith("data:")) return;
        const response = await fetch(image.src);
        if (!response.ok)
          throw new Error(`Could not load ${image.alt || "a terms image"}.`);
        image.src = await blobToDataUrl(await response.blob());
      }),
    ),
  );

  const markup = clones.map((clone) => clone.outerHTML).join("");
  const wordHtml = `<!doctype html>
    <html xmlns:o="urn:schemas-microsoft-com:office:office"
      xmlns:w="urn:schemas-microsoft-com:office:word">
      <head>
        <meta charset="utf-8">
        <meta http-equiv="Content-Type" content="text/html; charset=utf-8">
        <title>Employment terms</title>
        <style>
          @page { size: A4; margin: 0; }
          body { margin: 0; padding: 0; }
          .terms-paper { page-break-after: always; }
          .terms-paper:last-child { page-break-after: auto; }
        </style>
      </head>
      <body>${markup}</body>
    </html>`;
  saveBlob(
    new Blob(["\ufeff", wordHtml], { type: "application/msword;charset=utf-8" }),
    filename,
  );
}

function copyComputedStyles(source: HTMLElement, clone: HTMLElement) {
  const sourceElements = [source, ...source.querySelectorAll<HTMLElement>("*")];
  const cloneElements = [clone, ...clone.querySelectorAll<HTMLElement>("*")];
  sourceElements.forEach((sourceElement, index) => {
    const computed = window.getComputedStyle(sourceElement);
    const target = cloneElements[index];
    for (let propertyIndex = 0; propertyIndex < computed.length; propertyIndex += 1) {
      const property = computed.item(propertyIndex);
      target.style.setProperty(property, computed.getPropertyValue(property));
    }
  });
}

function blobToDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") resolve(reader.result);
      else reject(new Error("Could not embed a terms image in the Word file."));
    };
    reader.onerror = () =>
      reject(reader.error ?? new Error("Could not embed a terms image in the Word file."));
    reader.readAsDataURL(blob);
  });
}

function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => {
    const escapes: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return escapes[character];
  });
}
