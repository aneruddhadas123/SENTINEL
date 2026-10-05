"""Offline SENTINEL research model.

Input: a prepared, ethically sourced feature CSV. This script intentionally does
not download datasets or claim that laboratory stress labels predict crises.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import pandas as pd
import torch
from sklearn.metrics import classification_report, roc_auc_score
from sklearn.model_selection import train_test_split
from torch import nn
from torch.utils.data import DataLoader, TensorDataset


FEATURES = ["heart_rate_mean", "heart_rate_std", "gsr_mean", "gsr_slope"]


class ArousalClassifier(nn.Module):
    def __init__(self) -> None:
        super().__init__()
        self.layers = nn.Sequential(
            nn.Linear(len(FEATURES), 16),
            nn.ReLU(),
            nn.Dropout(0.15),
            nn.Linear(16, 8),
            nn.ReLU(),
            nn.Linear(8, 1),
        )

    def forward(self, values: torch.Tensor) -> torch.Tensor:
        return self.layers(values).squeeze(-1)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("csv", type=Path, help="Prepared physiological feature CSV")
    parser.add_argument("--output", type=Path, default=Path("ml/artifacts"))
    parser.add_argument("--epochs", type=int, default=80)
    args = parser.parse_args()

    frame = pd.read_csv(args.csv).dropna(subset=FEATURES + ["label"])
    x = frame[FEATURES].to_numpy(dtype=np.float32)
    y = frame["label"].to_numpy(dtype=np.float32)
    x_train, x_test, y_train, y_test = train_test_split(
        x, y, test_size=0.2, stratify=y, random_state=42
    )

    mean = x_train.mean(axis=0)
    scale = np.maximum(x_train.std(axis=0), 1e-6)
    x_train = (x_train - mean) / scale
    x_test = (x_test - mean) / scale

    train_data = TensorDataset(torch.from_numpy(x_train), torch.from_numpy(y_train))
    loader = DataLoader(train_data, batch_size=64, shuffle=True)
    model = ArousalClassifier()
    optimizer = torch.optim.AdamW(model.parameters(), lr=1e-3, weight_decay=1e-4)
    loss_function = nn.BCEWithLogitsLoss()

    model.train()
    for _ in range(args.epochs):
        for features, labels in loader:
            optimizer.zero_grad()
            loss = loss_function(model(features), labels)
            loss.backward()
            optimizer.step()

    model.eval()
    with torch.no_grad():
        probabilities = torch.sigmoid(model(torch.from_numpy(x_test))).numpy()
    predictions = (probabilities >= 0.5).astype(np.int64)
    print(classification_report(y_test.astype(np.int64), predictions, digits=3))
    print(f"ROC AUC: {roc_auc_score(y_test, probabilities):.3f}")

    args.output.mkdir(parents=True, exist_ok=True)
    torch.save(model.state_dict(), args.output / "sentinel_arousal.pt")
    (args.output / "normalization.json").write_text(
        json.dumps({"features": FEATURES, "mean": mean.tolist(), "scale": scale.tolist()}, indent=2),
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
