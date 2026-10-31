"""Generate a small live sample for every component in the gallery, with Claude.

Reads the current system prompt (examples/system-prompt.txt) and asks Claude for one short,
standalone OpenUI Lang program per component, about ten components per request. Writes
examples/gallery.json: {"ComponentName": "root = Card([...])\\n...", ...}.

The gallery only shows samples that render without errors, so a bad sample just falls back to the
component's signature. Run from the project folder (needs ANTHROPIC_API_KEY in .env):

    python scripts/generate_gallery.py               # every component without a sample yet
    python scripts/generate_gallery.py Meter Board   # only these (overwrites their samples)

To refresh examples/system-prompt.txt after changing components or tools: Chat tab -> Answer with
"Manual (copy and paste)" -> send any message -> copy the text between <instructions> and
</instructions>.
"""

import json
import re
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import anthropic
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
PROMPT = ROOT / "examples" / "system-prompt.txt"
OUT = ROOT / "examples" / "gallery.json"
MODEL = "claude-opus-5-5"
BATCH = 10

load_dotenv(ROOT / ".env")

INSTRUCTIONS = """For this request only, write a small gallery sample for each component listed below.

Rules for each sample:
- A complete, standalone OpenUI Lang program that starts with `root = Card([...])` and shows off
  that one component with realistic, made-up data. Add a CardHeader only if it helps.
- Keep it short (2 to 12 statements). Don't use Query, Mutation or tools; use literal data.
- Components that only work inside a parent (such as Col, Series, SelectItem or Column) are shown
  inside their parent.

Output format, exactly, for every component in the list and nothing else:
### ComponentName
root = Card([...])
...

Components: """


def components_in(prompt: str) -> list[str]:
    """Component names from the signature lines in the prompt's "Component Signatures" section,
    e.g. "Meter(label: string, ...) — ..." (some signatures have no description)."""
    section = prompt.split("## Component Signatures", 1)[-1].split("\n## ", 1)[0]
    return list(dict.fromkeys(re.findall(r"^([A-Z]\w*)\(", section, re.M)))


def generate(client: anthropic.Anthropic, system: str, names: list[str]) -> dict[str, str]:
    with client.messages.stream(
        model=MODEL,
        max_tokens=32000,
        system=system,
        messages=[{"role": "user", "content": INSTRUCTIONS + ", ".join(names)}],
        output_config={"effort": "low"},
    ) as stream:
        text = stream.get_final_message().content[-1].text
    samples = {}
    for block in re.split(r"^### ", text, flags=re.M)[1:]:
        name, _, code = block.partition("\n")
        code = "\n".join(l for l in code.splitlines() if not l.strip().startswith("```")).strip()
        if name.strip() in names and code.startswith("root"):
            samples[name.strip()] = code + "\n"
    return samples


def main():
    system = PROMPT.read_text()
    existing = json.loads(OUT.read_text()) if OUT.exists() else {}
    wanted = sys.argv[1:] or [n for n in components_in(system) if n not in existing]
    if not wanted:
        print("Every component already has a sample.")
        return
    batches = [wanted[i:i + BATCH] for i in range(0, len(wanted), BATCH)]
    print(f"Generating {len(wanted)} samples in {len(batches)} requests...")
    client = anthropic.Anthropic()
    with ThreadPoolExecutor(4) as pool:
        for batch, samples in zip(batches, pool.map(lambda b: generate(client, system, b), batches)):
            existing.update(samples)
            missing = sorted(set(batch) - set(samples))
            print(f"  {len(samples)}/{len(batch)}" + (f" (missing: {', '.join(missing)})" if missing else ""))
    OUT.write_text(json.dumps(dict(sorted(existing.items())), indent=2, ensure_ascii=False) + "\n")
    print(f"Wrote {OUT.relative_to(ROOT)} ({len(existing)} samples).")


if __name__ == "__main__":
    main()
