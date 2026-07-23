import { Button, FormField } from "../../components/Primitives";
import {
  characterLength,
  type ExampleDraftErrors,
  type ExampleDraftValues,
  type WineExample,
  type WineExampleSentiment,
} from "./palateProfile";

export const EMPTY_EXAMPLE_VALUES: ExampleDraftValues = {
  name: "",
  vintage: "",
  notes: "",
};

export interface ExampleFormState {
  open: boolean;
  values: ExampleDraftValues;
  errors: ExampleDraftErrors;
}

export type ExampleForms = Record<WineExampleSentiment, ExampleFormState>;

interface ValidationDetail {
  field: string;
  reason: string;
}

export function createExampleForms(): ExampleForms {
  return {
    enjoyed: {
      open: false,
      values: { ...EMPTY_EXAMPLE_VALUES },
      errors: {},
    },
    not_enjoyed: {
      open: false,
      values: { ...EMPTY_EXAMPLE_VALUES },
      errors: {},
    },
  };
}

function ExampleForm({
  sentiment,
  state,
  onChange,
  onAdd,
  onCancel,
}: {
  sentiment: WineExampleSentiment;
  state: ExampleFormState;
  onChange: (field: keyof ExampleDraftValues, value: string) => void;
  onAdd: () => void;
  onCancel: () => void;
}) {
  const idPrefix =
    sentiment === "enjoyed" ? "enjoyed-example" : "not-enjoyed-example";
  const notesHelpId = `${idPrefix}-notes-help`;
  const notesLength = characterLength(state.values.notes);
  const notesError =
    state.errors.notes ??
    (notesLength > 400
      ? "Keep notes to 400 characters or fewer."
      : undefined);

  return (
    <div className="example-form">
      <div className="example-form__row">
        <FormField
          id={`${idPrefix}-name`}
          label="Wine name"
          value={state.values.name}
          onChange={(event) => onChange("name", event.target.value)}
          error={state.errors.name}
          hint={`${characterLength(state.values.name)} of 120 characters`}
          autoComplete="off"
        />
        <FormField
          id={`${idPrefix}-vintage`}
          label="Vintage"
          value={state.values.vintage}
          onChange={(event) => onChange("vintage", event.target.value)}
          error={state.errors.vintage}
          hint="1000–2999 or NV"
          autoComplete="off"
        />
      </div>
      <div className="form-field">
        <label htmlFor={`${idPrefix}-notes`}>Notes</label>
        <textarea
          id={`${idPrefix}-notes`}
          value={state.values.notes}
          onChange={(event) => onChange("notes", event.target.value)}
          aria-describedby={notesHelpId}
          aria-invalid={notesError ? "true" : undefined}
          rows={3}
          placeholder="What stood out about this wine?"
        />
        <p
          id={notesHelpId}
          className={notesError ? "field-error" : "field-hint"}
        >
          {notesError ?? `${notesLength} of 400 characters`}
        </p>
      </div>
      {state.errors.form && (
        <p className="example-form__error" role="alert">
          {state.errors.form}
        </p>
      )}
      <div className="example-form__actions">
        <Button variant="quiet" onClick={onCancel}>
          Cancel
        </Button>
        <Button onClick={onAdd}>Add example</Button>
      </div>
    </div>
  );
}

function exampleValidationErrors({
  example,
  wineExamples,
  details,
}: {
  example: WineExample;
  wineExamples: WineExample[];
  details: ValidationDetail[];
}): string[] {
  const index = wineExamples.findIndex((item) => item.id === example.id);

  if (index < 0) {
    return [];
  }

  const field = `profile.wineExamples[${index}]`;
  return details
    .filter(
      (detail) =>
        detail.field === field || detail.field.startsWith(`${field}.`),
    )
    .map((detail) => detail.reason);
}

export function WineExamplesSection({
  sentiment,
  wineExamples,
  isEditing,
  form,
  validationDetails,
  onStartAdd,
  onChangeForm,
  onAdd,
  onCancelAdd,
  onRemove,
}: {
  sentiment: WineExampleSentiment;
  wineExamples: WineExample[];
  isEditing: boolean;
  form: ExampleFormState;
  validationDetails: ValidationDetail[];
  onStartAdd: () => void;
  onChangeForm: (field: keyof ExampleDraftValues, value: string) => void;
  onAdd: () => void;
  onCancelAdd: () => void;
  onRemove: (id: string) => void;
}) {
  const title =
    sentiment === "enjoyed"
      ? "Wines I enjoyed"
      : "Wines I did not enjoy";
  const examples = wineExamples.filter(
    (example) => example.sentiment === sentiment,
  );
  const sectionErrors = validationDetails
    .filter((detail) => detail.field === "profile.wineExamples")
    .map((detail) => detail.reason);

  return (
    <section className="examples-card" aria-labelledby={`${sentiment}-title`}>
      <div className="examples-card__heading">
        <div>
          <h2 id={`${sentiment}-title`}>{title}</h2>
          <p>
            {sentiment === "enjoyed"
              ? "Bottles you would happily drink again."
              : "What put you off can be just as useful."}
          </p>
        </div>
        <span>{examples.length} of 20</span>
      </div>
      <div className="example-list">
        {examples.length === 0 ? (
          <p className="example-list__empty">No examples yet.</p>
        ) : (
          examples.map((example) => {
            const errors = exampleValidationErrors({
              example,
              wineExamples,
              details: validationDetails,
            });

            return (
              <article className="example-item" key={example.id}>
                <div className="example-item__heading">
                  <h3>
                    {example.name} <span>{example.vintage}</span>
                  </h3>
                  {isEditing && (
                    <Button
                      variant="quiet"
                      className="example-remove"
                      aria-label={`Remove ${example.name} ${example.vintage} from ${title}`}
                      onClick={() => onRemove(example.id)}
                    >
                      Remove
                    </Button>
                  )}
                </div>
                <p
                  className={
                    example.notes ? undefined : "example-item__empty-note"
                  }
                >
                  {example.notes || "No notes added."}
                </p>
                {errors.map((error) => (
                  <p key={error} className="field-error" role="alert">
                    {error}
                  </p>
                ))}
              </article>
            );
          })
        )}
      </div>
      {sectionErrors.map((error) => (
        <p key={error} className="example-form__error" role="alert">
          {error}
        </p>
      ))}
      {isEditing &&
        (form.open ? (
          <ExampleForm
            sentiment={sentiment}
            state={form}
            onChange={onChangeForm}
            onAdd={onAdd}
            onCancel={onCancelAdd}
          />
        ) : examples.length >= 20 ? (
          <p className="examples-card__limit">
            This section has reached its 20-wine limit.
          </p>
        ) : (
          <Button
            variant="secondary"
            className="examples-card__add"
            onClick={onStartAdd}
          >
            Add a wine
          </Button>
        ))}
    </section>
  );
}
