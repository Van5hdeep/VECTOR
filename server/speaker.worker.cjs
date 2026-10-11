/**
 * Speaker-embedding worker. Runs in its own process because sherpa-onnx ships a
 * private copy of onnxruntime that cannot share a process with the one Kokoro uses.
 *
 * Protocol (Node IPC, advanced serialization):
 *   → { id, type: "init", model }            ← { id }
 *   → { id, type: "embed", samples }         ← { id, embedding } | { id, error }
 * `samples` is a Float32Array of 16 kHz mono audio in [-1, 1].
 */
const sherpa = require("sherpa-onnx-node");

let extractor = null;

function reply(message) {
  if (process.send) process.send(message);
}

process.on("message", (msg) => {
  try {
    if (msg.type === "init") {
      extractor = new sherpa.SpeakerEmbeddingExtractor({
        model: msg.model,
        numThreads: 2,
        debug: false,
        provider: "cpu",
      });
      reply({ id: msg.id });
    } else if (msg.type === "embed") {
      if (!extractor) throw new Error("Speaker model is not loaded.");
      const stream = extractor.createStream();
      stream.acceptWaveform({ sampleRate: 16000, samples: msg.samples });
      stream.inputFinished();
      if (!extractor.isReady(stream)) throw new Error("Audio too short to identify a voice.");
      reply({ id: msg.id, embedding: extractor.compute(stream) });
    }
  } catch (err) {
    reply({ id: msg.id, error: err && err.message ? err.message : String(err) });
  }
});

// Never outlive the server
process.on("disconnect", () => process.exit(0));
