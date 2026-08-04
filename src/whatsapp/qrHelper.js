import QRCode from 'qrcode';

/**
 * Generates a PNG image Buffer from a raw QR code string.
 * @param {string} qrString 
 * @returns {Promise<Buffer>}
 */
export async function generateQRBuffer(qrString) {
  try {
    const buffer = await QRCode.toBuffer(qrString, {
      type: 'png',
      width: 400,
      margin: 2,
      color: {
        dark: '#075E54', // WhatsApp Deep Green
        light: '#FFFFFF'
      }
    });
    return buffer;
  } catch (err) {
    console.error('Error generating QR buffer:', err);
    throw err;
  }
}
