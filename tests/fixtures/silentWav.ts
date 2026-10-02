// A decodable 1s silent mono 8-bit WAV, for mocking the local file server.
// Empty/garbage bodies fail to decode and now surface the load-error modal.
export function silentWav(): Buffer {
  const samples = 8000;
  const buf = Buffer.alloc(44 + samples, 128);
  buf.write("RIFF", 0); buf.writeUInt32LE(36 + samples, 4); buf.write("WAVE", 8);
  buf.write("fmt ", 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(8000, 24); buf.writeUInt32LE(8000, 28); buf.writeUInt16LE(1, 32); buf.writeUInt16LE(8, 34);
  buf.write("data", 36); buf.writeUInt32LE(samples, 40);
  return buf;
}
