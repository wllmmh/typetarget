import { MODEL_CATALOG, type ModelId, type ModelInfo } from "../domain/models";
import type { ApiKeyProvider } from "../domain/api-key";
import { t } from "../domain/i18n";
import { Dropdown, DropdownOption } from "./select-box";

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

/** Grouped by provider; each hosted provider's header carries the action that opens its API key dialog. */
export const ModelPicker = ({ value, disabled, savedKeyProviders, onChange, onEditKey }: ModelPickerProps) => {
  const selectedKeyProvider = keyProviderOf(MODEL_CATALOG[value]);
  const keyMissing = selectedKeyProvider !== null && !savedKeyProviders.includes(selectedKeyProvider);

  return (
    <Dropdown
      value={MODEL_CATALOG[value].label}
      disabled={disabled}
      labelledBy="model-heading"
      triggerClassName={keyMissing ? "key-missing" : undefined}
    >
      {(close) =>
        MODEL_GROUPS.map(([name, models]) => {
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
                      close();
                      onEditKey(keyProvider);
                    }}
                  >
                    {t("modelApiKey")}
                  </button>
                )}
              </div>
              {models.map((model) => (
                <DropdownOption
                  key={model.id}
                  selected={model.id === value}
                  onSelect={() => {
                    onChange(model.id);
                    close();
                  }}
                >
                  <span>{model.label}</span>
                  <span className="model-picker-size">{sizeText(model)}</span>
                </DropdownOption>
              ))}
            </div>
          );
        })
      }
    </Dropdown>
  );
};
