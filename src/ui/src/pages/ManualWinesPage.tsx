import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { Link } from "react-router-dom";
import { ApiError, type ApiClient } from "../api/apiClient";
import {
  createManualWine,
  deleteManualWine,
  listActiveManualWines,
  pollAssessmentUntilComplete,
  queuedRequestFromError,
  requestAssessment,
  updateManualWineDescription,
  type AssessmentPollingStatus,
  type ManualWine,
} from "../api/manualWineApi";
import { useApiClient } from "../api/useApiClient";
import {
  ApiErrorState,
  Button,
  DetailDrawer,
  EmptyState,
  FormField,
  InlineBanner,
  Modal,
  Skeleton,
  StatusBadge,
  TextAreaField,
  WineCard,
} from "../components/Primitives";
import type { PublicConfig } from "../config";
import { PageHeading } from "./PlaceholderPages";

interface ManualWineDraft {
  name: string;
  vintage: string;
  description: string;
}

type DraftErrors = Partial<Record<keyof ManualWineDraft, string>>;

type AssessmentState =
  | { status: "requesting" | "queued" | "processing" | "completed" }
  | { status: "timed_out" | "error"; message: string };

type PollAssessment = typeof pollAssessmentUntilComplete;

const emptyDraft: ManualWineDraft = {
  name: "",
  vintage: "",
  description: "",
};

export function ManualWinesRoute({ config }: { config: PublicConfig }) {
  const apiClient = useApiClient(config);

  return <ManualWinesPage apiClient={apiClient} />;
}

export function ManualWinesPage({
  apiClient,
  pollAssessment = pollAssessmentUntilComplete,
}: {
  apiClient: ApiClient;
  pollAssessment?: PollAssessment;
}) {
  const mounted = useRef(true);
  const [wines, setWines] = useState<ManualWine[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<unknown>();
  const [draft, setDraft] = useState<ManualWineDraft>(emptyDraft);
  const [draftErrors, setDraftErrors] = useState<DraftErrors>({});
  const [createError, setCreateError] = useState<string>();
  const [isCreating, setIsCreating] = useState(false);
  const [assessmentStates, setAssessmentStates] = useState<
    Record<string, AssessmentState>
  >({});
  const [editingWine, setEditingWine] = useState<ManualWine>();
  const [editDescription, setEditDescription] = useState("");
  const [editError, setEditError] = useState<string>();
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [deleteWine, setDeleteWine] = useState<ManualWine>();
  const [deleteError, setDeleteError] = useState<string>();
  const [isDeleting, setIsDeleting] = useState(false);
  const [notice, setNotice] = useState<string>();

  const loadWines = useCallback(async () => {
    setLoadError(undefined);

    try {
      const activeWines = await listActiveManualWines(apiClient);

      if (mounted.current) {
        setWines(activeWines);
      }
    } catch (error) {
      if (mounted.current) {
        setLoadError(error);
      }
    } finally {
      if (mounted.current) {
        setIsLoading(false);
      }
    }
  }, [apiClient]);

  useEffect(() => {
    mounted.current = true;
    void loadWines();

    return () => {
      mounted.current = false;
    };
  }, [loadWines]);

  const updateDraft = (field: keyof ManualWineDraft, value: string) => {
    setDraft((current) => ({ ...current, [field]: value }));
    setDraftErrors((current) => ({ ...current, [field]: undefined }));
    setCreateError(undefined);
  };

  const setAssessmentState = (
    sourceKey: string,
    state: AssessmentState,
  ) => {
    if (!mounted.current) {
      return;
    }

    setAssessmentStates((current) => ({
      ...current,
      [sourceKey]: state,
    }));
  };

  const followAssessment = (
    wine: ManualWine,
    request: Awaited<ReturnType<typeof requestAssessment>>,
  ) => {
    void pollAssessment({
      apiClient,
      request,
      shouldContinue: () => mounted.current,
      onStatus: (status: AssessmentPollingStatus) => {
        setAssessmentState(wine.sourceKey, { status });
      },
    })
      .then(async (result) => {
        if (result.status === "completed") {
          setAssessmentState(wine.sourceKey, { status: "completed" });
          setNotice(
            `${wine.name} ${wine.vintage} is assessed. The completed result is available in History.`,
          );
          await loadWines();
        } else if (result.status === "timed_out") {
          setAssessmentState(wine.sourceKey, {
            status: "timed_out",
            message:
              "This is taking longer than expected. It may still complete in the background.",
          });
        }
      })
      .catch((error: unknown) => {
        setAssessmentState(wine.sourceKey, {
          status: "error",
          message: safeErrorMessage(
            error,
            "The assessment could not be checked. You can try again.",
          ),
        });
      });
  };

  const beginAssessment = async (wine: ManualWine) => {
    if (wine.status !== "active") {
      return false;
    }

    setAssessmentState(wine.sourceKey, { status: "requesting" });

    try {
      let request;

      try {
        request = await requestAssessment(apiClient, wine.sourceKey);
      } catch (error) {
        request = queuedRequestFromError(error, wine.sourceKey);

        if (!request) {
          throw error;
        }
      }

      setAssessmentState(wine.sourceKey, { status: "queued" });
      followAssessment(wine, request);
      return true;
    } catch (error) {
      setAssessmentState(wine.sourceKey, {
        status: "error",
        message: safeErrorMessage(
          error,
          "The assessment was not queued. Your wine is still saved.",
        ),
      });
      return false;
    }
  };

  const submitCreate = async (
    event: FormEvent<HTMLFormElement>,
  ) => {
    event.preventDefault();
    await saveNewWine(true);
  };

  const saveNewWine = async (assessAfterSaving: boolean) => {
    const validation = validateDraft(draft);

    if (Object.keys(validation).length > 0) {
      setDraftErrors(validation);
      setCreateError(undefined);
      return;
    }

    setIsCreating(true);
    setCreateError(undefined);
    setDraftErrors({});

    try {
      const wine = await createManualWine(apiClient, {
        name: draft.name.trim(),
        vintage: draft.vintage,
        description: draft.description,
      });

      setWines((current) => [
        wine,
        ...current.filter((item) => item.id !== wine.id),
      ]);
      setDraft(emptyDraft);

      if (assessAfterSaving) {
        const queued = await beginAssessment(wine);
        setNotice(
          queued
            ? `${wine.name} ${wine.vintage} is saved and queued for assessment.`
            : `${wine.name} ${wine.vintage} is saved, but its assessment was not queued. Retry it from the active list.`,
        );
      } else {
        setNotice(
          `${wine.name} ${wine.vintage} is saved. Request an assessment when you are ready.`,
        );
      }
    } catch (error) {
      setCreateError(
        error instanceof ApiError &&
          error.code === "MANUAL_WINE_ALREADY_EXISTS"
          ? "You already have a manual wine with this name and vintage, including any deleted entry."
          : safeErrorMessage(
              error,
              "The wine could not be saved. Your entries have been kept.",
            ),
      );
      setDraftErrors(fieldErrorsFromApi(error));
    } finally {
      setIsCreating(false);
    }
  };

  const openEditor = (wine: ManualWine) => {
    if (wine.status !== "active") {
      return;
    }

    setEditingWine(wine);
    setEditDescription(wine.description);
    setEditError(undefined);
  };

  const closeEditor = () => {
    if (!isSavingEdit) {
      setEditingWine(undefined);
      setEditError(undefined);
    }
  };

  const saveDescription = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!editingWine || editingWine.status !== "active") {
      return;
    }

    if (Array.from(editDescription).length > 2_000) {
      setEditError("Description must be 2,000 characters or fewer.");
      return;
    }

    setIsSavingEdit(true);
    setEditError(undefined);

    try {
      const updated = await updateManualWineDescription(
        apiClient,
        editingWine.id,
        editDescription,
      );
      setWines((current) =>
        current.map((wine) => (wine.id === updated.id ? updated : wine)),
      );
      setEditingWine(undefined);
      setNotice(
        `${updated.name} ${updated.vintage} was updated. Its earlier assessment may now be stale.`,
      );
    } catch (error) {
      setEditError(
        safeErrorMessage(
          error,
          "The description could not be saved. Your edit has been kept.",
        ),
      );
    } finally {
      setIsSavingEdit(false);
    }
  };

  const openDeleteConfirmation = (wine: ManualWine) => {
    if (wine.status !== "active") {
      return;
    }

    setDeleteWine(wine);
    setDeleteError(undefined);
  };

  const closeDeleteConfirmation = () => {
    if (!isDeleting) {
      setDeleteWine(undefined);
      setDeleteError(undefined);
    }
  };

  const confirmDelete = async () => {
    if (!deleteWine || deleteWine.status !== "active") {
      return;
    }

    setIsDeleting(true);
    setDeleteError(undefined);

    try {
      await deleteManualWine(apiClient, deleteWine.id);
      setWines((current) =>
        current.filter((wine) => wine.id !== deleteWine.id),
      );
      setEditingWine((current) =>
        current?.id === deleteWine.id ? undefined : current,
      );
      setAssessmentStates((current) => {
        const next = { ...current };
        delete next[deleteWine.sourceKey];
        return next;
      });
      setNotice(
        `${deleteWine.name} ${deleteWine.vintage} was removed from active manual wines. Past assessments remain in History.`,
      );
      setDeleteWine(undefined);
    } catch (error) {
      setDeleteError(
        safeErrorMessage(
          error,
          "The wine could not be deleted. It remains active.",
        ),
      );
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="page-stack manual-wines-page">
      <PageHeading
        eyebrow="A bottle of your own"
        title="Assess a wine"
        description="Save a bottle you entered yourself, then assess it against your current palate."
      />

      <InlineBanner>
        <span>
          Name and vintage permanently identify a manual wine. Deleted wines
          leave this active list, while completed assessments remain available
          in <Link to="/history">History</Link>.
        </span>
      </InlineBanner>

      {notice && (
        <InlineBanner>
          <span>
            {notice} <Link to="/history">Open History</Link>
          </span>
        </InlineBanner>
      )}

      <div className="manual-wine-layout">
        <section
          className="manual-wine-create"
          aria-labelledby="manual-wine-create-title"
        >
          <div className="section-heading">
            <p className="eyebrow">New manual wine</p>
            <h2 id="manual-wine-create-title">Add the bottle</h2>
            <p>
              Give the assessor the identity and description you know. Only
              the description can be edited later.
            </p>
          </div>

          <form onSubmit={submitCreate} noValidate>
            {createError && (
              <InlineBanner tone="error">{createError}</InlineBanner>
            )}
            <FormField
              id="manual-wine-name"
              label="Name"
              value={draft.name}
              onChange={(event) => updateDraft("name", event.target.value)}
              error={draftErrors.name}
              maxLength={120}
              autoComplete="off"
              required
            />
            <FormField
              id="manual-wine-vintage"
              label="Vintage"
              value={draft.vintage}
              onChange={(event) => updateDraft("vintage", event.target.value)}
              error={draftErrors.vintage}
              hint="Use a four-digit year from 1000 to 2999, or uppercase NV."
              placeholder="2019 or NV"
              inputMode="text"
              autoComplete="off"
              required
            />
            <TextAreaField
              id="manual-wine-description"
              label="Description"
              value={draft.description}
              onChange={(event) =>
                updateDraft("description", event.target.value)
              }
              error={draftErrors.description}
              hint={`${Array.from(draft.description).length} of 2,000 characters`}
              maxLength={2_000}
              rows={7}
            />
            <p className="identity-note">
              Name and vintage cannot be changed after saving.
            </p>
            <div className="form-actions">
              <Button type="submit" disabled={isCreating}>
                {isCreating ? "Saving…" : "Save and request assessment"}
              </Button>
              <Button
                variant="secondary"
                onClick={() => void saveNewWine(false)}
                disabled={isCreating}
              >
                Save only
              </Button>
            </div>
          </form>
        </section>

        <section
          className="manual-wine-list"
          aria-labelledby="active-manual-wines-title"
        >
          <div className="section-heading section-heading--list">
            <div>
              <p className="eyebrow">Your own bottles</p>
              <h2 id="active-manual-wines-title">Active manual wines</h2>
            </div>
            {!isLoading && !loadError && (
              <span className="manual-wine-count">
                {wines.length} active
              </span>
            )}
          </div>

          {isLoading && <Skeleton label="Loading active manual wines" />}
          {!isLoading && loadError !== undefined && (
            <ApiErrorState error={loadError} onRetry={() => void loadWines()} />
          )}
          {!isLoading && !loadError && wines.length === 0 && (
            <EmptyState
              title="No active manual wines"
              message="Add a bottle here when it is not already in your current wine list."
            />
          )}
          {!isLoading && !loadError && wines.length > 0 && (
            <div className="manual-wine-cards" aria-live="polite">
              {wines.map((wine) => {
                const assessmentState = assessmentStates[wine.sourceKey];
                const assessmentBusy =
                  assessmentState?.status === "requesting" ||
                  assessmentState?.status === "queued" ||
                  assessmentState?.status === "processing";

                return (
                  <WineCard
                    key={wine.id}
                    name={wine.name}
                    vintage={wine.vintage}
                    details={wine.description || "No description added yet."}
                    aside={<WineStatus wine={wine} state={assessmentState} />}
                  >
                    {wine.latestAssessment?.headline && (
                      <p className="assessment-headline">
                        “{wine.latestAssessment.headline}”
                      </p>
                    )}
                    <AssessmentMessage state={assessmentState} />
                    <div className="card-actions">
                      <Button
                        onClick={() => void beginAssessment(wine)}
                        disabled={assessmentBusy}
                      >
                        {assessmentActionLabel(wine, assessmentState)}
                      </Button>
                      <Button
                        variant="secondary"
                        onClick={() => openEditor(wine)}
                      >
                        Edit description
                      </Button>
                      <Button
                        variant="quiet"
                        onClick={() => openDeleteConfirmation(wine)}
                      >
                        Delete wine
                      </Button>
                    </div>
                  </WineCard>
                );
              })}
            </div>
          )}
        </section>
      </div>

      <DetailDrawer
        open={Boolean(editingWine)}
        title="Edit manual wine"
        onClose={closeEditor}
      >
        {editingWine && (
          <form className="manual-wine-editor" onSubmit={saveDescription}>
            <div className="locked-identity" aria-label="Locked wine identity">
              <p className="eyebrow">Permanent identity</p>
              <strong>
                {editingWine.name} <span>{editingWine.vintage}</span>
              </strong>
              <p>Name and vintage cannot be edited after creation.</p>
            </div>
            {editError && (
              <InlineBanner tone="error">{editError}</InlineBanner>
            )}
            <TextAreaField
              id="edit-manual-wine-description"
              label="Description"
              value={editDescription}
              onChange={(event) => {
                setEditDescription(event.target.value);
                setEditError(undefined);
              }}
              hint={`${Array.from(editDescription).length} of 2,000 characters`}
              maxLength={2_000}
              rows={10}
            />
            <div className="form-actions">
              <Button type="submit" disabled={isSavingEdit}>
                {isSavingEdit ? "Saving…" : "Save description"}
              </Button>
              <Button
                variant="secondary"
                onClick={closeEditor}
                disabled={isSavingEdit}
              >
                Cancel
              </Button>
            </div>
          </form>
        )}
      </DetailDrawer>

      <Modal
        open={Boolean(deleteWine)}
        title={deleteWine ? `Delete ${deleteWine.name}?` : "Delete wine?"}
        onClose={closeDeleteConfirmation}
      >
        <div className="confirmation-content">
          <p>
            This removes the manual wine from the active list. Its completed
            assessments stay in History, but the deleted wine cannot be edited
            or assessed again.
          </p>
          {deleteError && (
            <InlineBanner tone="error">{deleteError}</InlineBanner>
          )}
          <div className="form-actions form-actions--end">
            <Button
              variant="secondary"
              onClick={closeDeleteConfirmation}
              disabled={isDeleting}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={() => void confirmDelete()}
              disabled={isDeleting}
            >
              {isDeleting ? "Deleting…" : "Delete wine"}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

function WineStatus({
  wine,
  state,
}: {
  wine: ManualWine;
  state?: AssessmentState;
}) {
  if (
    state?.status === "requesting" ||
    state?.status === "queued" ||
    state?.status === "processing"
  ) {
    return (
      <StatusBadge tone="warning">
        {state.status === "requesting" ? "Requesting" : state.status}
      </StatusBadge>
    );
  }

  if (state?.status === "completed") {
    return <StatusBadge tone="positive">Completed</StatusBadge>;
  }

  if (state?.status === "error" || state?.status === "timed_out") {
    return <StatusBadge tone="warning">Needs attention</StatusBadge>;
  }

  if (!wine.latestAssessment) {
    return <StatusBadge>Unassessed</StatusBadge>;
  }

  return wine.freshness.isCurrent ? (
    <StatusBadge tone="positive">Current</StatusBadge>
  ) : (
    <StatusBadge tone="warning">Reassessment due</StatusBadge>
  );
}

function AssessmentMessage({ state }: { state?: AssessmentState }) {
  if (!state) {
    return null;
  }

  if (state.status === "queued") {
    return (
      <p className="assessment-status" role="status">
        Queued for assessment. The first completion check starts in two
        seconds.
      </p>
    );
  }

  if (state.status === "processing") {
    return (
      <p className="assessment-status" role="status">
        Waiting for the completed assessment…
      </p>
    );
  }

  if (state.status === "completed") {
    return (
      <p className="assessment-status assessment-status--complete" role="status">
        Assessment complete. <Link to="/history">View it in History</Link>.
      </p>
    );
  }

  if (state.status === "timed_out" || state.status === "error") {
    return (
      <p className="assessment-status assessment-status--error" role="alert">
        {state.message}
      </p>
    );
  }

  return (
    <p className="assessment-status" role="status">
      Requesting an assessment…
    </p>
  );
}

function assessmentActionLabel(
  wine: ManualWine,
  state?: AssessmentState,
) {
  if (state?.status === "requesting") {
    return "Requesting…";
  }
  if (state?.status === "queued") {
    return "Queued";
  }
  if (state?.status === "processing") {
    return "Assessing…";
  }
  if (state?.status === "error" || state?.status === "timed_out") {
    return "Retry assessment";
  }
  return wine.latestAssessment ? "Reassess" : "Request assessment";
}

function validateDraft(draft: ManualWineDraft): DraftErrors {
  const errors: DraftErrors = {};
  const nameLength = Array.from(draft.name.trim()).length;
  const vintageYear = /^\d{4}$/.test(draft.vintage)
    ? Number(draft.vintage)
    : null;

  if (nameLength < 1 || nameLength > 120) {
    errors.name = "Name must be between 1 and 120 characters.";
  }

  if (
    draft.vintage !== "NV" &&
    (vintageYear === null || vintageYear < 1000 || vintageYear > 2999)
  ) {
    errors.vintage =
      "Vintage must be a four-digit year from 1000 to 2999, or uppercase NV.";
  }

  if (Array.from(draft.description).length > 2_000) {
    errors.description = "Description must be 2,000 characters or fewer.";
  }

  return errors;
}

function fieldErrorsFromApi(error: unknown): DraftErrors {
  if (
    !(error instanceof ApiError) ||
    !Array.isArray(error.details)
  ) {
    return {};
  }

  return error.details.reduce<DraftErrors>((errors, detail) => {
    if (
      (detail.field === "name" ||
        detail.field === "vintage" ||
        detail.field === "description") &&
      typeof detail.reason === "string"
    ) {
      errors[detail.field] = detail.reason;
    }
    return errors;
  }, {});
}

function safeErrorMessage(error: unknown, fallback: string) {
  return error instanceof ApiError ? error.message : fallback;
}
