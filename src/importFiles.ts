import * as fs from "fs";
import * as path from "path";
import { Utils } from "./utils.js";

/**
 * Handle #import statements.
 * Give a string, look for "#import" or "#diff" statements.
 * #import file: actls like #import or #include file, by replacing the statement with the contents of a file
 * #diff does the same but also provides a hint that the result of the request, will need to go into this file
 */
export function importFiles(content: string): [boolean, string, string[]] {
  // Split the content into lines
  const lines = content.split("\n");

  // Initialize a new list to store the modified lines
  const modifiedLines: string[] = [];

  let success = true; // Set the success flag to true
  let text = ""; // Initialize the text variable

  // Initialize an array to store the names of the imported files
  const toDiffFiles: string[] = [];

  // Iterate through the lines of the string
  for (const line of lines) {
    // Match the #import statement using a regular expression
    const importFile = line.match(/^\s*#import\s+[~\w\\./]+/);
    // Match the #diff statement using a regular expression
    // Diffed files will later by diffed with the output from the bot
    const diffFile = line.match(/^\s*#diff\s+[~\w\\./]+/);
    if (importFile || diffFile) {
      // If the line is an #import or #diff statement, extract the file name
      const fname = line.split(/\s+/)[1];
      const filePath = Utils.normalizePath(fname); // Normalize the file path
      if (diffFile) {
        //If it's a #diff statement
        toDiffFiles.push(filePath); // Append the file name to the files array
      }

      try {
        // Open the file and read its contents
        const fileContents = fs.readFileSync(filePath, "utf-8");

        // Add the file contents to the modified lines list
        modifiedLines.push(...fileContents.split("\n"));
      } catch (e) {
        // If the file can't be opened
        return [false, `#import file ${filePath} was not found`, toDiffFiles];
      }
    } else {
      // If the line is not an #import or #diff statement, add it to the modified lines list as is
      modifiedLines.push(line);
    }
  }

  // Return: true -- success, Join the modified lines into a single string and the list of changed files
  return [true, modifiedLines.join("\n"), toDiffFiles];
}
