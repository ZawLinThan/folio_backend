import { OpenRouter } from '@openrouter/sdk';
import ollama from 'ollama'
import { env } from './env.js';
import { ModelOutputError } from '../lib/errors.js';
import { tagProviderError } from '../lib/providerRateLimit.js';

const response = await ollama.embed({
  model: 'nomic-embed-text',
  input: 'The sky is blue because of Rayleigh scattering',
})
console.log(response.embeddings)

const openrouter = new OpenRouter({
  apiKey: env.OPENROUTER_API_KEY,
});

/**
 * @description Embed Text function
 *
 * @param text - the text to be embedded
 * @returns Embedded number array for the text
 * @throws {ModelOutputError} If the model cannot produce Number[] array
 */
export const embedText = async (text: string): Promise<number[]> => {
  try {
    const embedding = await openrouter.embeddings.generate({
      requestBody: {
        model: env.EMBEDDING_MODEL,
        input: text,
        encodingFormat: "float",
      },
    });

    //console.log(embedding.data[0].embedding.length);

    // Reject unexpected SDK response variants before reading the vector.
    if (
      typeof embedding === "string" ||
            !Array.isArray(embedding.data?.[0]?.embedding)
    ) {
      throw new ModelOutputError("The embedding response contained no vector.");
    }

    return embedding.data[0].embedding;
  } catch (error) {
    throw tagProviderError(error, "openrouter embedding");
  }
};
