import { useState } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  ApiError,
  type ApiClient,
  type ApiErrorDetail,
} from "../api/apiClient";
import { useAuthenticatedApiClient } from "../api/ApiClientProvider";
import {
  ApiErrorState,
  Button,
  EmptyState,
  InlineBanner,
  Modal,
  Skeleton,
  StatusBadge,
  Toast,
} from "../components/Primitives";
import {
  createExampleForms,
  EMPTY_EXAMPLE_VALUES,
  WineExamplesSection,
} from "../features/palate-profile/PalateProfileExamples";
import {
  PalateProfilePreferences,
} from "../features/palate-profile/PalateProfilePreferences";
import {
  createEmptyPalateProfileDraft,
  formatProfileDate,
  profileToDraft,
  validateExampleDraft,
  type ExampleDraftValues,
  type PalateProfile,
  type PalateProfileDraft,
  type PreferenceSelection,
  type StylePreferenceKey,
  type StylePreferenceValue,
  type WineExample,
  type WineExampleSentiment,
} from "../features/palate-profile/palateProfile";

const PROFILE_QUERY_KEY = ["palate-profile"] as const;

type ValidationDetail = ApiErrorDetail & {
  field: string;
  reason: string;
};

function isValidationDetail(detail: ApiErrorDetail): detail is ValidationDetail {
  return typeof detail.field === "string" && typeof detail.reason === "string";
}

function shouldRetryProfile(failureCount: number, error: Error): boolean {
  if (error instanceof ApiError && error.status >= 400 && error.status < 500) {
    return false;
  }

  return failureCount < 1;
}

function safeErrorMessage(error: unknown): string {
  return error instanceof ApiError
    ? error.message
    : "Something went wrong while saving your palate profile.";
}

function PageHeading({
  profile,
  editingVersion,
  isEditing,
  onEdit,
  onCancel,
  onSave,
  saving,
}: {
  profile: PalateProfile | null;
  editingVersion: number | null;
  isEditing: boolean;
  onEdit: () => void;
  onCancel: () => void;
  onSave: () => void;
  saving: boolean;
}) {
  const displayedVersion = isEditing
    ? editingVersion
    : profile?.palateProfileVersion ?? null;

  return (
    <header className="palate-heading">
      <div>
        <p className="eyebrow">Your preferences</p>
        <h1>Palate profile</h1>
        <div className="palate-heading__meta">
          <StatusBadge tone="positive">
            {displayedVersion === null
              ? "New profile"
              : `Version ${displayedVersion}`}
          </StatusBadge>
          {profile?.updatedAt && (
            <span>Updated {formatProfileDate(profile.updatedAt)}</span>
          )}
        </div>
      </div>
      <div className="palate-heading__actions">
        {isEditing ? (
          <>
            <Button variant="secondary" onClick={onCancel} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={onSave} disabled={saving}>
              Save changes
            </Button>
          </>
        ) : (
          <Button onClick={onEdit}>Edit profile</Button>
        )}
      </div>
    </header>
  );
}

export function PalateProfilePage() {
  const apiClient = useAuthenticatedApiClient();
  return <PalateProfilePageContent apiClient={apiClient} />;
}

export function PalateProfilePageContent({
  apiClient,
  createId = () => crypto.randomUUID(),
}: {
  apiClient: ApiClient;
  createId?: () => string;
}) {
  const queryClient = useQueryClient();
  const [isEditing, setIsEditing] = useState(false);
  const [editingVersion, setEditingVersion] = useState<number | null>(null);
  const [draft, setDraft] = useState<PalateProfileDraft | null>(null);
  const [exampleForms, setExampleForms] = useState(createExampleForms);
  const [saveConfirmationOpen, setSaveConfirmationOpen] = useState(false);
  const [conflict, setConflict] = useState<{
    currentVersion: number | null;
  } | null>(null);
  const [reloadError, setReloadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [validationDetails, setValidationDetails] = useState<
    ValidationDetail[]
  >([]);
  const [toast, setToast] = useState<string | null>(null);

  const profileQuery = useQuery({
    queryKey: PROFILE_QUERY_KEY,
    queryFn: async () => {
      try {
        const response = await apiClient.request<PalateProfile>(
          "/v1/palate-profile",
        );
        return response.data;
      } catch (error) {
        if (
          error instanceof ApiError &&
          error.status === 404 &&
          error.code === "PALATE_PROFILE_NOT_FOUND"
        ) {
          return null;
        }

        throw error;
      }
    },
    retry: shouldRetryProfile,
    refetchOnWindowFocus: false,
  });

  const saveProfile = useMutation({
    mutationFn: async ({
      expectedPalateProfileVersion,
      profile,
    }: {
      expectedPalateProfileVersion: number | null;
      profile: PalateProfileDraft;
    }) => {
      const response = await apiClient.request<PalateProfile>(
        "/v1/palate-profile",
        {
          method: "PUT",
          body: JSON.stringify({
            expectedPalateProfileVersion,
            profile,
          }),
        },
      );
      return response.data;
    },
  });

  const resetEditing = () => {
    setIsEditing(false);
    setEditingVersion(null);
    setDraft(null);
    setExampleForms(createExampleForms());
    setSaveConfirmationOpen(false);
    setConflict(null);
    setReloadError(null);
    setSaveError(null);
    setValidationDetails([]);
  };

  const startEditing = () => {
    const profile = profileQuery.data ?? null;
    setDraft(
      profile ? profileToDraft(profile) : createEmptyPalateProfileDraft(),
    );
    setEditingVersion(profile?.palateProfileVersion ?? null);
    setIsEditing(true);
    setExampleForms(createExampleForms());
    setSaveError(null);
    setValidationDetails([]);
  };

  const togglePreference = (
    preferenceKey: StylePreferenceKey,
    group: keyof PreferenceSelection,
    value: StylePreferenceValue,
  ) => {
    setDraft((current) => {
      if (!current) {
        return current;
      }

      const selection = current.stylePreferences[preferenceKey];
      const oppositeGroup = group === "preferred" ? "avoided" : "preferred";
      const selected = selection[group].includes(value);

      return {
        ...current,
        stylePreferences: {
          ...current.stylePreferences,
          [preferenceKey]: {
            ...selection,
            [group]: selected
              ? selection[group].filter((item) => item !== value)
              : [...selection[group], value],
            [oppositeGroup]: selection[oppositeGroup].filter(
              (item) => item !== value,
            ),
          },
        },
      };
    });
    setValidationDetails([]);
    setSaveError(null);
  };

  const startAddingExample = (sentiment: WineExampleSentiment) => {
    setExampleForms((current) => ({
      ...current,
      [sentiment]: {
        open: true,
        values: { ...EMPTY_EXAMPLE_VALUES },
        errors: {},
      },
    }));
  };

  const cancelAddingExample = (sentiment: WineExampleSentiment) => {
    setExampleForms((current) => ({
      ...current,
      [sentiment]: {
        open: false,
        values: { ...EMPTY_EXAMPLE_VALUES },
        errors: {},
      },
    }));
  };

  const changeExampleForm = (
    sentiment: WineExampleSentiment,
    field: keyof ExampleDraftValues,
    value: string,
  ) => {
    setExampleForms((current) => ({
      ...current,
      [sentiment]: {
        ...current[sentiment],
        values: {
          ...current[sentiment].values,
          [field]: value,
        },
        errors: {
          ...current[sentiment].errors,
          [field]: undefined,
          form: undefined,
        },
      },
    }));
  };

  const addExample = (sentiment: WineExampleSentiment) => {
    if (!draft) {
      return;
    }

    const form = exampleForms[sentiment];
    const errors = validateExampleDraft({
      values: form.values,
      sentiment,
      wineExamples: draft.wineExamples,
    });

    if (Object.keys(errors).length > 0) {
      setExampleForms((current) => ({
        ...current,
        [sentiment]: {
          ...current[sentiment],
          errors,
        },
      }));
      return;
    }

    const example: WineExample = {
      id: createId(),
      name: form.values.name.trim(),
      vintage: form.values.vintage.trim(),
      sentiment,
      notes: form.values.notes,
    };

    setDraft((current) =>
      current
        ? {
            ...current,
            wineExamples: [...current.wineExamples, example],
          }
        : current,
    );
    cancelAddingExample(sentiment);
    setValidationDetails([]);
    setSaveError(null);
  };

  const removeExample = (id: string) => {
    setDraft((current) =>
      current
        ? {
            ...current,
            wineExamples: current.wineExamples.filter(
              (example) => example.id !== id,
            ),
          }
        : current,
    );
    setValidationDetails([]);
    setSaveError(null);
  };

  const requestSave = () => {
    const openForms = ([
      "enjoyed",
      "not_enjoyed",
    ] as WineExampleSentiment[]).filter(
      (sentiment) => exampleForms[sentiment].open,
    );

    if (openForms.length > 0) {
      setExampleForms((current) => {
        const next = structuredClone(current);

        for (const sentiment of openForms) {
          next[sentiment].errors.form =
            "Add this example or cancel the form before saving.";
        }

        return next;
      });
      return;
    }

    setSaveConfirmationOpen(true);
  };

  const confirmSave = async () => {
    if (!draft) {
      return;
    }

    setSaveError(null);
    setValidationDetails([]);

    try {
      const savedProfile = await saveProfile.mutateAsync({
        expectedPalateProfileVersion: editingVersion,
        profile: draft,
      });

      queryClient.setQueryData(PROFILE_QUERY_KEY, savedProfile);
      resetEditing();
      setToast(
        `Profile saved as version ${savedProfile.palateProfileVersion}. Existing assessments were not reassessed.`,
      );
    } catch (error) {
      setSaveConfirmationOpen(false);

      if (
        error instanceof ApiError &&
        error.status === 409 &&
        error.code === "PROFILE_VERSION_CONFLICT"
      ) {
        const currentVersion =
          !Array.isArray(error.details) &&
          typeof error.details?.currentPalateProfileVersion === "number"
            ? error.details.currentPalateProfileVersion
            : null;
        setConflict({ currentVersion });
        return;
      }

      if (
        error instanceof ApiError &&
        error.status === 400 &&
        Array.isArray(error.details)
      ) {
        const details = error.details.filter(isValidationDetail);
        setValidationDetails(details);
        setSaveError(
          details.length > 0
            ? "Review the highlighted profile fields, then save again."
            : error.message,
        );
        return;
      }

      setSaveError(safeErrorMessage(error));
    }
  };

  const reloadLatest = async () => {
    setReloadError(null);
    const result = await profileQuery.refetch();

    if (result.isError) {
      setReloadError(
        result.error instanceof ApiError
          ? result.error.message
          : "The latest profile could not be loaded. Your draft is still here.",
      );
      return;
    }

    resetEditing();
    setToast("The latest profile has been loaded for review.");
  };

  if (profileQuery.isPending) {
    return (
      <div className="palate-page">
        <header className="page-heading">
          <p className="eyebrow">Your preferences</p>
          <h1>Palate profile</h1>
          <p>Loading the profile that guides your wine assessments.</p>
        </header>
        <div className="palate-loading" aria-label="Loading palate profile">
          <Skeleton />
          <Skeleton />
          <Skeleton />
        </div>
      </div>
    );
  }

  if (profileQuery.isError && profileQuery.data === undefined) {
    return (
      <div className="palate-page">
        <header className="page-heading">
          <p className="eyebrow">Your preferences</p>
          <h1>Palate profile</h1>
          <p>Describe the styles and bottles that have shaped your taste.</p>
        </header>
        <section className="content-panel">
          <ApiErrorState
            error={profileQuery.error}
            onRetry={() => void profileQuery.refetch()}
          />
        </section>
      </div>
    );
  }

  const profile = profileQuery.data ?? null;

  if (!profile && !isEditing) {
    return (
      <div className="palate-page">
        <header className="page-heading">
          <p className="eyebrow">Your preferences</p>
          <h1>Palate profile</h1>
          <p>Describe the styles and bottles that have shaped your taste.</p>
        </header>
        <section className="content-panel">
          <EmptyState
            title="Start your palate profile"
            message="Choose the styles you prefer or avoid, then add wines that help explain your taste."
            action={<Button onClick={startEditing}>Create profile</Button>}
          />
        </section>
        <InlineBanner>
          Creating or updating your profile does not automatically reassess
          existing wines.
        </InlineBanner>
      </div>
    );
  }

  const displayedProfile = draft ?? profileToDraft(profile as PalateProfile);
  const nextVersion = editingVersion === null ? 1 : editingVersion + 1;

  return (
    <div className="palate-page">
      <PageHeading
        profile={profile}
        editingVersion={editingVersion}
        isEditing={isEditing}
        onEdit={startEditing}
        onCancel={resetEditing}
        onSave={requestSave}
        saving={saveProfile.isPending}
      />

      <InlineBanner tone={isEditing ? "warning" : "info"}>
        {isEditing ? (
          <>
            <strong>Saving creates version {nextVersion}.</strong> Existing
            wine assessments stay unchanged and are not reassessed
            automatically.
          </>
        ) : (
          <>
            Profile changes create a new version. Existing wine assessments
            are not reassessed automatically.
          </>
        )}
      </InlineBanner>

      {saveError && (
        <InlineBanner tone="error">
          <strong>We could not save this profile.</strong> {saveError}
        </InlineBanner>
      )}

      <section className="palate-section" aria-labelledby="style-heading">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Structured preferences</p>
            <h2 id="style-heading">What suits your palate</h2>
          </div>
          {isEditing && <span>Choose any that apply</span>}
        </div>
        <PalateProfilePreferences
          stylePreferences={displayedProfile.stylePreferences}
          isEditing={isEditing}
          validationDetails={validationDetails}
          onToggle={togglePreference}
        />
      </section>

      <section className="palate-section" aria-labelledby="examples-heading">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Wine examples</p>
            <h2 id="examples-heading">Bottles that explain your taste</h2>
          </div>
          <span>Up to 20 in each list</span>
        </div>
        <div className="examples-grid">
          {(["enjoyed", "not_enjoyed"] as WineExampleSentiment[]).map(
            (sentiment) => (
              <WineExamplesSection
                key={sentiment}
                sentiment={sentiment}
                wineExamples={displayedProfile.wineExamples}
                isEditing={isEditing}
                form={exampleForms[sentiment]}
                validationDetails={validationDetails}
                onStartAdd={() => startAddingExample(sentiment)}
                onChangeForm={(field, value) =>
                  changeExampleForm(sentiment, field, value)
                }
                onAdd={() => addExample(sentiment)}
                onCancelAdd={() => cancelAddingExample(sentiment)}
                onRemove={removeExample}
              />
            ),
          )}
        </div>
      </section>

      {conflict ? (
        <Modal
          open
          title="This profile changed elsewhere"
          onClose={() => {
            if (!profileQuery.isFetching) {
              setConflict(null);
              setReloadError(null);
            }
          }}
        >
          <div className="modal-copy">
            <StatusBadge tone="warning">Version conflict</StatusBadge>
            <p>
              A newer profile
              {conflict.currentVersion
                ? ` (version ${conflict.currentVersion})`
                : ""} exists.
              Your draft has not been overwritten. Reload the latest version
              before deciding which changes to make.
            </p>
            <p>
              Reloading will replace this unsaved draft so you can review the
              current profile safely.
            </p>
            {reloadError && <p className="field-error">{reloadError}</p>}
          </div>
          <div className="modal-actions">
            <Button
              variant="secondary"
              onClick={() => {
                setConflict(null);
                setReloadError(null);
              }}
              disabled={profileQuery.isFetching}
            >
              Keep reviewing my edits
            </Button>
            <Button
              onClick={() => void reloadLatest()}
              disabled={profileQuery.isFetching}
            >
              {profileQuery.isFetching
                ? "Loading latest…"
                : "Reload latest and discard draft"}
            </Button>
          </div>
        </Modal>
      ) : (
        <Modal
          open={saveConfirmationOpen}
          title={`Save as version ${nextVersion}?`}
          onClose={() => {
            if (!saveProfile.isPending) {
              setSaveConfirmationOpen(false);
            }
          }}
        >
          <div className="modal-copy">
            <p>
              Saving sends the complete profile and creates a new immutable
              version. Existing wine assessments stay as they are and are not
              reassessed automatically.
            </p>
          </div>
          <div className="modal-actions">
            <Button
              variant="secondary"
              onClick={() => setSaveConfirmationOpen(false)}
              disabled={saveProfile.isPending}
            >
              Keep editing
            </Button>
            <Button
              onClick={() => void confirmSave()}
              disabled={saveProfile.isPending}
            >
              {saveProfile.isPending
                ? "Saving…"
                : `Save version ${nextVersion}`}
            </Button>
          </div>
        </Modal>
      )}

      {toast && <Toast onDismiss={() => setToast(null)}>{toast}</Toast>}
    </div>
  );
}
