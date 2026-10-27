use std::{env, fs, io::{self, Cursor, Read}, path::Path};
use jieba_rs::Jieba;
use serde_json::{json, Value};
#[path = "../../engine/dictionary.rs"]
mod dictionary_format;

fn run() -> Result<(), String> {
    let args: Vec<_> = env::args().skip(1).collect();
    if args.as_slice() == ["--help"] {
        println!("Usage: search-eval-tokenizer --dict ABSOLUTE_PATH < input.json\nInput: {{\"texts\":[\"...\"]}}. Output: {{\"tokens\":[[{{\"word\":\"...\",\"startByte\":0,\"endByte\":3}}]]}}");
        return Ok(());
    }
    if args.len() != 2 || args[0] != "--dict" || !Path::new(&args[1]).is_absolute() {
        return Err("expected --dict ABSOLUTE_PATH; use --help".into());
    }
    let dictionary = fs::read_to_string(&args[1]).map_err(|e| format!("dictionary {}: {e}", args[1]))?;
    dictionary_format::validate_dictionary(&dictionary)?;
    let jieba = Jieba::with_dict(&mut Cursor::new(dictionary.as_bytes())).map_err(|e| format!("Jieba dictionary: {e}"))?;
    let mut input = String::new();
    io::stdin().read_to_string(&mut input).map_err(|e| format!("stdin: {e}"))?;
    let value: Value = serde_json::from_str(&input).map_err(|e| format!("input JSON: {e}"))?;
    let texts = value.get("texts").and_then(Value::as_array).ok_or("input must contain a texts array")?;
    let mut output = Vec::with_capacity(texts.len());
    for (index, text) in texts.iter().enumerate() {
        let text = text.as_str().ok_or_else(|| format!("texts[{index}] must be a string"))?;
        let mut offset = 0usize;
        let mut tokens = Vec::new();
        // The borrowed slices retain every space, punctuation mark and unknown character.
        for token in jieba.cut(text, false) {
            let end = offset + token.word.len();
            if text.get(offset..end) != Some(token.word) {
                return Err(format!("Jieba output did not preserve contiguous UTF-8 coverage at texts[{index}] byte {offset}"));
            }
            tokens.push(json!({"word":token.word,"startByte":offset,"endByte":end}));
            offset = end;
        }
        if offset != text.len() {
            return Err(format!("Jieba output did not cover texts[{index}]"));
        }
        output.push(tokens);
    }
    println!("{}", json!({"tokens":output}));
    Ok(())
}

fn main() {
    if let Err(error) = run() {
        eprintln!("search-eval-tokenizer: {error}");
        std::process::exit(2);
    }
}
