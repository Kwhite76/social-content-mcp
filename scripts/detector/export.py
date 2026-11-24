"""Converts desklib/ai-text-detector-v1.01 to ONNX for the extension's AI-writing check.

Writes to OUT_DIR: model-fp32.onnx, model-int8.onnx (dynamic int8 quantization), tokenizer.json,
tokenizer_config.json, and expected.json: the original PyTorch model's AI probability for every
sample sentence, plus the tokenizer's ids, so the Node side can be checked against it exactly.
The model class is the one from the model card (mean pooling over the last hidden state, one logit).
"""
import json
import os
import sys

import torch
import torch.nn as nn
from transformers import AutoConfig, AutoModel, AutoTokenizer, PreTrainedModel

REPO = "desklib/ai-text-detector-v1.01"
OUT = sys.argv[1] if len(sys.argv) > 1 else "build/detector"
SAMPLES = os.path.join(os.path.dirname(__file__), "samples.json")
os.makedirs(OUT, exist_ok=True)


class DesklibAIDetectionModel(PreTrainedModel):
    config_class = AutoConfig

    def __init__(self, config):
        super().__init__(config)
        self.model = AutoModel.from_config(config)
        self.classifier = nn.Linear(config.hidden_size, 1)
        self.post_init()

    def forward(self, input_ids, attention_mask):
        last_hidden_state = self.model(input_ids, attention_mask=attention_mask)[0]
        mask = attention_mask.unsqueeze(-1).expand(last_hidden_state.size()).float()
        pooled = torch.sum(last_hidden_state * mask, dim=1) / torch.clamp(mask.sum(dim=1), min=1e-9)
        return self.classifier(pooled)


tokenizer = AutoTokenizer.from_pretrained(REPO)
model = DesklibAIDetectionModel.from_pretrained(REPO).eval()
tokenizer.save_pretrained(OUT)  # tokenizer.json (fast) and tokenizer_config.json
assert os.path.exists(os.path.join(OUT, "tokenizer.json")), "no fast tokenizer.json was written"

# the original model's scores, one sentence at a time (padding doesn't change mean-pooled results)
samples = json.load(open(SAMPLES))
expected = []
with torch.no_grad():
    for s in samples:
        enc = tokenizer(s, truncation=True, max_length=512, return_tensors="pt")
        p = torch.sigmoid(model(enc["input_ids"], enc["attention_mask"])).item()
        expected.append({"text": s, "ids": enc["input_ids"][0].tolist(), "probability": p})
json.dump(expected, open(os.path.join(OUT, "expected.json"), "w"), indent=1)

# export: dynamic batch and length
enc = tokenizer(["A short sentence for tracing the model.", "Another one, a bit longer, with padding in it."],
                padding=True, return_tensors="pt")
fp32 = os.path.join(OUT, "model-fp32.onnx")
torch.onnx.export(
    model, (enc["input_ids"], enc["attention_mask"]), fp32,
    input_names=["input_ids", "attention_mask"], output_names=["logits"],
    dynamic_axes={"input_ids": {0: "batch", 1: "length"}, "attention_mask": {0: "batch", 1: "length"}, "logits": {0: "batch"}},
    opset_version=17, do_constant_folding=True, dynamo=False,
)

from onnxruntime.quantization import QuantType, quantize_dynamic  # noqa: E402

quantize_dynamic(fp32, os.path.join(OUT, "model-int8.onnx"), weight_type=QuantType.QInt8)
for f in sorted(os.listdir(OUT)):
    print(f, os.path.getsize(os.path.join(OUT, f)) // 1_000_000, "MB")
