import { useEffect, useRef, useState } from "react";
import { MODEL_CATALOG, type ModelId, type ModelInfo } from "../domain/models";
import type { ApiKeyProvider } from "../domain/api-key";
import { t } from "../domain/i18n";
import { SelectCaret } from "./select-box";

/** The picker's sections: one per provider, in catalog order, so each model is listed
 * once under its provider's name instead of repeating it on every option. */
const MODEL_GROUPS: [string, ModelInfo[]][] = Object.entries(
  Object.values(MODEL_CATALOG).reduce<Record<string, ModelInfo[]>>(
    (groups, model) => ({
      ...groups,
      [model.name]: [...(groups[model.name] ?? []), model],
    }),
    {},
  ),
);

const sizeText = (model: ModelInfo): string | null =>
  model.approxSizeMb !== undefined ? t("modelSize", model.approxSizeMb) : null;

/** Hosted groups are named after their provider, which stays as is; "Local" is a word, so it is translated. */
const groupLabel = ([model]: ModelInfo[]): string | undefined =>
  model?.provider === "whisper-cpp" ? t("modelGroupLocal") : model?.name;

/** The provider whose key this model needs; null for local models. */
const keyProviderOf = ({ provider, requiresApiKey }: ModelInfo): ApiKeyProvider | null =>
  requiresApiKey && provider !== "whisper-cpp" ? provider : null;

type ModelPickerProps = {
  value: ModelId;
  disabled: boolean;
  savedKeyProviders: ApiKeyProvider[];
  onChange: (modelId: ModelId) => void;
  onEditKey: (provider: ApiKeyProvider) => void;
};

/**
 * Not a native `<select>`: an `<option>` can't hold a button, and each hosted provider's group
 * header carries the action that opens its API key dialog. Rows are plain buttons inside a
 * disclosure panel (not role="option"), because a listbox option must not contain interactive content.
 */
export const ModelPicker = ({ value, disabled, savedKeyProviders, onChange, onEditKey }: ModelPickerProps) => {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  // Capturing locks the model, and the panel must not stay open over a locked picker.
  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  const selectedKeyProvider = keyProviderOf(MODEL_CATALOG[value]);
  const keyMissing = selectedKeyProvider !== null && !savedKeyProviders.includes(selectedKeyProvider);

  return (
    <div className="model-picker" ref={rootRef}>
      <button
        type="button"
        className={keyMissing ? "select-box model-picker-trigger key-missing" : "select-box model-picker-trigger"}
        disabled={disabled}
        aria-expanded={open}
        onClick={() => setOpen((wasOpen) => !wasOpen)}
      >
        <span className="model-picker-value">{MODEL_CATALOG[value].label}</span>
        <SelectCaret />
      </button>
      {open && (
        <div className="model-picker-panel">
          {MODEL_GROUPS.map(([name, models]) => {
            const keyProvider = models.map(keyProviderOf).find((provider) => provider !== null) ?? null;
            const label = groupLabel(models) ?? name;
            return (
              <div key={name} role="group" aria-label={label}>
                <div className="model-picker-group">
                  {label}
                  {/* A hosted provider's key is set from its heading, right-aligned like a row's size. */}
                  {keyProvider !== null && (
                    <button
                      type="button"
                      className="model-picker-key-action"
                      onClick={() => {
                        setOpen(false);
                        onEditKey(keyProvider);
                      }}
                    >
                      {t("modelApiKey")}
                    </button>
                  )}
                </div>
                {models.map((model) => (
                  <button
                    key={model.id}
                    type="button"
                    className="model-picker-option"
                    aria-pressed={model.id === value}
                    onClick={() => {
                      onChange(model.id);
                      setOpen(false);
                    }}
                  >
                    <span>{model.label}</span>
                    <span className="model-picker-size">{sizeText(model)}</span>
                  </button>
                ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
