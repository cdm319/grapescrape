import {
  preferenceValueLabel,
  STYLE_PREFERENCE_DETAILS,
  STYLE_PREFERENCE_KEYS,
  STYLE_PREFERENCE_VALUES,
  type PreferenceSelection,
  type StylePreferenceKey,
  type StylePreferences,
  type StylePreferenceValue,
} from "./palateProfile";

interface ValidationDetail {
  field: string;
  reason: string;
}

function PreferenceValueList({
  label,
  values,
  tone,
}: {
  label: string;
  values: StylePreferenceValue[];
  tone: "preferred" | "avoided";
}) {
  return (
    <div className="preference-summary">
      <h3>{label}</h3>
      {values.length === 0 ? (
        <p>None selected</p>
      ) : (
        <ul aria-label={label}>
          {values.map((value) => (
            <li
              key={value}
              className={`preference-chip preference-chip--${tone}`}
            >
              {preferenceValueLabel(value)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function PreferenceCard({
  preferenceKey,
  selection,
  isEditing,
  validationErrors,
  onToggle,
}: {
  preferenceKey: StylePreferenceKey;
  selection: PreferenceSelection;
  isEditing: boolean;
  validationErrors: string[];
  onToggle: (
    preferenceKey: StylePreferenceKey,
    group: keyof PreferenceSelection,
    value: StylePreferenceValue,
  ) => void;
}) {
  const details = STYLE_PREFERENCE_DETAILS[preferenceKey];

  return (
    <fieldset className="preference-card">
      <legend>{details.label}</legend>
      <p className="preference-card__description">{details.description}</p>
      {isEditing ? (
        <div className="preference-editor">
          {(["preferred", "avoided"] as const).map((group) => (
            <div key={group}>
              <h3>{group === "preferred" ? "Prefer" : "Avoid"}</h3>
              <div className="preference-options">
                {STYLE_PREFERENCE_VALUES[preferenceKey].map((value) => {
                  const selected = selection[group].includes(value);
                  const action = group === "preferred" ? "Prefer" : "Avoid";

                  return (
                    <button
                      key={value}
                      type="button"
                      className={`preference-option preference-option--${group}`}
                      aria-label={`${action} ${preferenceValueLabel(value)}`}
                      aria-pressed={selected}
                      onClick={() => onToggle(preferenceKey, group, value)}
                    >
                      {preferenceValueLabel(value)}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="preference-summary-grid">
          <PreferenceValueList
            label="Preferred"
            values={selection.preferred}
            tone="preferred"
          />
          <PreferenceValueList
            label="Avoided"
            values={selection.avoided}
            tone="avoided"
          />
        </div>
      )}
      {validationErrors.map((error) => (
        <p key={error} className="field-error" role="alert">
          {error}
        </p>
      ))}
    </fieldset>
  );
}

export function PalateProfilePreferences({
  stylePreferences,
  isEditing,
  validationDetails,
  onToggle,
}: {
  stylePreferences: StylePreferences;
  isEditing: boolean;
  validationDetails: ValidationDetail[];
  onToggle: (
    preferenceKey: StylePreferenceKey,
    group: keyof PreferenceSelection,
    value: StylePreferenceValue,
  ) => void;
}) {
  return (
    <div className="preference-grid">
      {STYLE_PREFERENCE_KEYS.map((preferenceKey) => (
        <PreferenceCard
          key={preferenceKey}
          preferenceKey={preferenceKey}
          selection={stylePreferences[preferenceKey]}
          isEditing={isEditing}
          validationErrors={validationDetails
            .filter((detail) =>
              detail.field.startsWith(
                `profile.stylePreferences.${preferenceKey}`,
              ),
            )
            .map((detail) => detail.reason)}
          onToggle={onToggle}
        />
      ))}
    </div>
  );
}
