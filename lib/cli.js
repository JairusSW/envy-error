import { green, bgBlack } from "kleur/colors";
import { URL } from "url";
import path from "path";
import arg from "arg";
import glob from "glob-promise";
import asc from "assemblyscript/dist/asc.js";
import { WASI } from "wasi";
import fs from "fs";

const SIZE_OFFSET = -4;
const parsed = new URL(import.meta.url);
const filePath = path.resolve(parsed.pathname.slice(1));
const fileDir = path.dirname(filePath);
const assemblyEntry = path.join(fileDir, "../assembly/index.ts");

// I am a firm believer that every good cli should have some kind of ascii text art
const textArt = bgBlack(green(`
███████ ███    ██ ██    ██ ██    ██ 
██      ████   ██ ██    ██  ██  ██  
█████   ██ ██  ██ ██    ██   ████   
██      ██  ██ ██  ██  ██     ██    
███████ ██   ████   ████      ██    
`));


// entry point
export async function main(argv = process.argv.slice(2)) {
  process.stdout.write(textArt);

  // check for rest argument
  let rest = [];
  const indexOfRest = argv.indexOf("--")
  if (indexOfRest !== -1) {
    rest = argv.slice(indexOfRest);
    argv = argv.slice(0, indexOfRest);
  }

  // parse the arguments
  const config = arg({
    "--help": Boolean,
    "--basedir": String,
    "--target": String,
  }, {
    argv,
  });

  // obtain configuration values
  const globs = config._;
  // const help = config["--help"];
  const basedir = config["--basedir"] ?? process.cwd();
  const target = config["--target"] ?? "debug";
  
  // get all the entry files
  const fileSets = [];
  for (const globset of globs) {
    fileSets.push(
      await glob(globset, {
        nodir: true,
        absolute: true,
        root: path.resolve(basedir)
      })
    );
  }
  const files = Array.from(new Set([].concat.apply([assemblyEntry], fileSets)));

  // create an index 
  const index = new Map();

  const {
    error,
    stats,
    stderr,
    stdout,
  } = await asc.main([
    "--importMemory",
    "--target", target,
    "--bindings", "raw",
  ].concat(files), {
    writeFile(filename, contents, baseDir) {
      const fullPath = path.join(baseDir, filename);
      index.set(fullPath, contents);
    }
  });

  process.stdout.write(stdout.toString() + "\n");

  // obtain the wasm binary
  let wasm = null;
  for (const [name, binary] of index.entries()) {
    if (name.endsWith(".wasm")) {
      wasm = binary;
    }
    if (name.endsWith(".wat")) {
      fs.writeFileSync(name, binary);
    }
  }

  if (!wasm) {
    process.stderr.write("No wasm binary found. Exiting code 1.\n");
    process.stderr.write(stderr.toString() + "\n");
    process.exit(1);
  }

  let mod = new WebAssembly.Module(wasm);
  const memory = new WebAssembly.Memory({ initial: 4 });
  const utf16 = new TextDecoder("utf-16le", { fatal: true });

  /** Gets a string from memory. */
  const getString =  (ptr) => {
    let len = new Uint32Array(memory.buffer)[ptr + SIZE_OFFSET >>> 2] >>> 1;
    const wtf16 = new Uint16Array(buffer, ptr, len);
    return utf16.decode(wtf16);
  };

  const wasi = new WASI({
    args: rest,
    env: process.env,
  });

  let instance = await WebAssembly.instantiate(mod, {
    env: {
      memory,
      abort(msg, file, line, col) {
        process.stdout.write(`abort: ${getString(msg)} at ${getString(file)}:${line}:${col}\n`);
        process.exit(1);
      }
    },
    wasi_snapshot_preview1: wasi.wasiImport,
  });
  wasi.initialize(instance);
  instance.exports._startTests();

  // wasi.start(instance);
  process.stdout.write(`All tests pass. You a green with envy.\n`);
}


if (filePath === process.argv[1] + ".js") {
  main();
}