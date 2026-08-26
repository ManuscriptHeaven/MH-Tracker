import { runVoiceAssistantTests } from '../src/lib/ai/voiceAssistant.test.ts';

runVoiceAssistantTests()
  .then(() => {
    console.log("Voice Assistant test suite completed.");
  })
  .catch((err) => {
    console.error("Test failed:", err);
    process.exit(1);
  });
