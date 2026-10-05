# SENTINEL model research scaffold

This folder supports offline experimentation; it is not a clinically validated model.

`train_model.py` expects a feature CSV with one row per analysis window and these columns:

- `heart_rate_mean`
- `heart_rate_std`
- `gsr_mean`
- `gsr_slope`
- `label` (`0` calm/baseline, `1` elevated/stress)

The script standardizes features using the training split, trains a compact PyTorch classifier, reports held-out metrics, and saves both the model weights and normalization values. Subject-independent evaluation should split by participant, not by random windows, before any research claim is made.

WESAD and the other referenced datasets primarily label laboratory stress or psychological state. They do not establish behavioral-crisis prediction for autistic people or people with developmental disabilities.
