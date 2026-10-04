// The qrcode package ships no types; this is the one call we use.
declare module 'qrcode' {
  const QRCode: { toString(text: string, opts?: { type?: 'svg' | 'utf8' | 'terminal'; errorCorrectionLevel?: 'L' | 'M' | 'Q' | 'H'; margin?: number; color?: { dark?: string; light?: string } }): Promise<string> };
  export default QRCode;
}
