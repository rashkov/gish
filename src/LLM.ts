import { Configuration, OpenAIApi } from "openai";
import * as fs from "fs";
import * as os from "os";
import chalk from "chalk";
import { countTokens } from "gptoken";
import { Settings } from "./settings.js";

// interface message  { role: 'assistant', content: 'tell me a joke' } ,
export interface message {
  role: string;
  content: string;
}

export interface GptResult {
  text: string;
  tokens: number;
}

let API_KEY = null;
if (process.env.OPENAI_API_KEY) {
  API_KEY = process.env.OPENAI_API_KEY;
} else {
  try {
    const file = `${os.homedir()}/.openai`;
    if (fs.existsSync(file)) {
      API_KEY = fs.readFileSync(file, "utf8").trimEnd();
    }
  } catch (e) {
    // ignore errors
  }
}
if (!API_KEY) {
  console.error(
    chalk.red(
      "Unable to find the OpenAI API key. Please set OPENAI_API_KEY environment variable or put your key in ~/.openai file."
    )
  );
  process.exit(1);
}
const configuration = new Configuration({
  apiKey: API_KEY,
});
/**
 * The LLM, Long Language Model, class is the main class for the handling the requests to the OpenAI API.
 * It contains the fetch function that calls the OpenAI API.
 */
export class LLM {
  openai = new OpenAIApi(configuration);
  model = Settings.getSetting("DEFAULT_MODEL");
  constructor() {}
  /**
   * The fetch function calls the OpenAI API to generate a response to the query.
   * It returns a promise that resolves to the response.
   * @param query
   * @example const result = await fetch('What is the population of the city of London?');
   */
  async fetch(queries: Array<message>, options: any, spinner: any) {
    if (options["model"]) {
      this.model = options["model"];
    }
    const stream = options["stream"];
    if (stream) {
      return await this.streamResponse(queries, options, spinner);
    }
    // non-streaming response
    try {
      const completion = await this.openai.createChatCompletion({
        model: this.model,
        messages: <any>queries,
      });
      /*
       * data: {
       * id: 'cmpl-6XKRMiJZifNtJuP29w34AXw7ZfkX5',
       * object: 'text_completion',
       * created: 1673401416,
       * model: 'text-davinci-003',
       * choices: [ message: { role: 'assistant', content: '\n\nSELECT * FROM film LIMIT 10;' } ],
       * usage: { prompt_tokens: 254, completion_tokens: 23, total_tokens: 277 }
       * }
       */
      const response = completion.data;
      let tokens = 0;
      let text = "";
      if (response.usage) {
        tokens = response.usage.total_tokens;
      }
      if (
        response.choices &&
        response.choices.length > 0 &&
        response.choices[0].message
      ) {
        text = response.choices[0].message["content"];
      }
      const textWithQuery = queries[0].content + text;
      const estimateTokens = countTokens(textWithQuery);
      return { text: text, tokens: tokens };
    } catch (error: any) {
      if (error.response) {
        console.error(error.response.status);
        console.error(error.response.data);
      } else {
        console.error(error.message);
      }
      return { text: "Error:" + error.message, tokens: 0 };
    }
  }
  /**
   * The streamResponse function calls the OpenAI API and streams the response to the query,
   * so that the response is printed to the console as it is generated.
   * @param query
   * @example const result = await fetch('What is the population of the city of London?');
   */
  async streamResponse(queries: Array<message>, options: any, spinner: any) {
    // return a promise with await that resolves to the response
    return new Promise(async (resolve, reject) => {
      // based on https://github.com/openai/openai-node/issues/18#issuecomment-1369996933
      // need to jump through ugly hoops to get streaming to work because the opeanai node library doesn't support
      // streaming responses
      let first = true;
      try {
        let response = "";
        const messages = queries;
        let prompt = "";
        if (options["prompt"]) {
          prompt = options["prompt"];
          const promptContent = fs.readFileSync(prompt, "utf8");
          messages.push({ role: "system", content: promptContent });
        }
        const res = await this.openai.createChatCompletion(
          {
            model: this.model,
            messages: <any>messages,
            stream: true,
          },
          { responseType: "stream" }
        );
        // tell typescript to ignore no 'on'
        // @ts-ignore
        res.data.on("data", (data: any) => {
          const lines = data
            .toString()
            .split("\n")
            .filter((line: string) => line.trim() !== "");
          for (const line of lines) {
            const message = line.replace(/^data: /, "");
            if (message === "[DONE]") {
              let tokens = 0;
              process.stdout.write(chalk.green("\n"));
              if (res.data.usage) {
                tokens = res.data.usage.total_tokens;
              } else {
                tokens = 0; // to indicate that we don't know the number of tokens
              }
              resolve({ text: response, tokens: tokens });
              return; // Stream finished
            }
            try {
              const parsed = JSON.parse(message);
              let text = parsed.choices[0].delta.content;
              if (text) {
                if (spinner) {
                  spinner.stop(); // starting to see a response, so stop the spinner
                  spinner = null;
                }
                if (first && text.match(/^\s*$/)) {
                  // ignore the first empty line
                } else {
                  // convert multiple newlines to a single newline
                  text = text.replace(/\n+/g, "\n");
                  process.stdout.write(chalk.green(text));
                  response += text;
                }
                first = false;
              }
            } catch (error) {
              console.error(
                "Could not JSON parse stream message",
                message,
                error
              );
            }
          }
        });
      } catch (error: any) {
        if (error.response?.status) {
          console.error(error.response.status, error.message);
          error.response.data.on("data", (data: any) => {
            const message = data.toString();
            try {
              const parsed = JSON.parse(message);
              console.error(
                "An error occurred during OpenAI request: ",
                parsed
              );
            } catch (error) {
              console.error(
                "An error occurred during OpenAI request: ",
                message
              );
            }
          });
        } else {
          console.error("An error occurred during OpenAI request", error);
        }
        if (spinner) {
          spinner.stop(); // starting to see a response, so stop the spinner
        }
        resolve({ text: "Error:" + error.message, tokens: 0 });
        // Intentionally resolve with empty string, rather than reject
      }
    });
  }
}
