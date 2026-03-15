export const compressImage = (dataUrl: string, maxWidth = 800, quality = 0.7): Promise<string> => {
  return new Promise((resolve) => {
    const img = new Image();
    const timeout = setTimeout(() => {
      console.warn("Image compression timed out, returning original");
      resolve(dataUrl);
    }, 5000);

    img.onload = () => {
      clearTimeout(timeout);
      const canvas = document.createElement('canvas');
      let width = img.width;
      let height = img.height;

      if (width > height) {
        if (width > maxWidth) {
          height *= maxWidth / width;
          width = maxWidth;
        }
      } else {
        if (height > maxWidth) {
          width *= maxWidth / height;
          height = maxWidth;
        }
      }

      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        console.error("Could not get canvas context for compression");
        resolve(dataUrl);
        return;
      }
      
      ctx.drawImage(img, 0, 0, width, height);
      try {
        resolve(canvas.toDataURL('image/jpeg', quality));
      } catch (e) {
        console.error("Canvas toDataURL failed:", e);
        resolve(dataUrl);
      }
    };

    img.onerror = (err) => {
      clearTimeout(timeout);
      console.error("Image compression failed, returning original", err);
      resolve(dataUrl);
    };

    img.src = dataUrl;
  });
};
