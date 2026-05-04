"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Modal,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  Button,
  Input,
  Textarea,
  Select,
  SelectItem,
  RadioGroup,
  Radio,
} from "@heroui/react";
import {
  EVE_BACKGROUND_ACTIONS,
  type BackgroundTask,
  type BackgroundTaskType,
} from "@eve/dna";

/**
 * Add / Edit intent modal.
 *
 * Same component for both flows — when `intent` is provided we PATCH,
 * otherwise we POST. The form intentionally only exposes the fields
 * that map cleanly onto the Hub Protocol create/update bodies; runtime
 * fields (counts, lastRunAt, …) are read-only and shown on the row.
 */

interface FormState {
  name: string;
  description: string;
  type: BackgroundTaskType;
  schedule: string;
  action: string;
  prompt: string;
}

const DEFAULT_FORM: FormState = {
  name: "",
  description: "",
  type: "interval",
  schedule: "",
  action: "custom",
  prompt: "",
};

const ACTION_OPTIONS = Object.values(EVE_BACKGROUND_ACTIONS);

function placeholderForType(type: BackgroundTaskType): string {
  if (type === "cron") return "0 9 * * *  (cron expression)";
  if (type === "interval") return "30m  (e.g. 30m, 1h, 6h)";
  return "event:entity.created  (event pattern)";
}

function pullPrompt(context: Record<string, unknown> | undefined): string {
  if (!context) return "";
  const v = (context as { userPrompt?: unknown }).userPrompt;
  return typeof v === "string" ? v : "";
}

interface Props {
  /** Triggers `isOpen` of the underlying HeroUI Modal. */
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  /** When set the modal switches to "edit" mode and PATCHes by id. */
  intent?: BackgroundTask | null;
  /** Refresh callback fired after a successful create/update. */
  onSaved: () => void;
}

export function IntentFormModal({ isOpen, onOpenChange, intent, onSaved }: Props) {
  const isEdit = !!intent;
  const [form, setForm] = useState<FormState>(DEFAULT_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset / hydrate the form whenever the modal opens or the target intent
  // changes — guarantees stale values from a previous edit don't leak.
  useEffect(() => {
    if (!isOpen) return;
    if (intent) {
      setForm({
        name: intent.name,
        description: intent.description ?? "",
        type: intent.type,
        schedule: intent.schedule ?? "",
        action: intent.action,
        prompt: pullPrompt(intent.context),
      });
    } else {
      setForm(DEFAULT_FORM);
    }
    setError(null);
  }, [isOpen, intent]);

  const canSubmit = useMemo(() => {
    if (!form.name.trim()) return false;
    if (!form.action.trim()) return false;
    return true;
  }, [form]);

  async function handleSubmit(close: () => void) {
    if (!canSubmit) {
      setError("Name and action are required.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const payload: Record<string, unknown> = {
        name: form.name.trim(),
        type: form.type,
        action: form.action,
      };
      if (form.description.trim()) payload.description = form.description.trim();
      if (form.schedule.trim()) payload.schedule = form.schedule.trim();
      const context: Record<string, unknown> = {};
      if (form.prompt.trim()) context.userPrompt = form.prompt.trim();
      if (Object.keys(context).length > 0) payload.context = context;

      const url = isEdit ? `/api/intents/${intent!.id}` : "/api/intents";
      const method = isEdit ? "PATCH" : "POST";
      const res = await fetch(url, {
        method,
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
          validActions?: Array<{ id: string; description: string }>;
        };
        setError(body.error ?? `Request failed (${res.status})`);
        return;
      }
      onSaved();
      close();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      size="2xl"
      scrollBehavior="inside"
      backdrop="blur"
    >
      <ModalContent>
        {(close) => (
          <>
            <ModalHeader className="flex flex-col gap-1">
              <span>{isEdit ? "Edit intent" : "Add intent"}</span>
              <span className="text-sm font-normal text-default-500">
                {isEdit
                  ? "Update the schedule, action, or prompt."
                  : "Schedule a background task Hermes will pick up on its next poll."}
              </span>
            </ModalHeader>
            <ModalBody className="space-y-4">
              {error && (
                <div className="rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">
                  {error}
                </div>
              )}

              <Input
                label="Name"
                placeholder="Morning briefing"
                value={form.name}
                onValueChange={(v) => setForm((f) => ({ ...f, name: v }))}
                isRequired
              />

              <Select
                label="Action"
                selectedKeys={new Set([form.action])}
                onSelectionChange={(keys) => {
                  const next = Array.from(keys as Set<string>)[0];
                  if (next) setForm((f) => ({ ...f, action: next }));
                }}
                isRequired
              >
                {ACTION_OPTIONS.map((a) => (
                  <SelectItem key={a.id} textValue={a.id}>
                    <div className="flex flex-col">
                      <span className="font-mono text-xs">{a.id}</span>
                      <span className="text-[11px] text-default-500">
                        {a.description}
                      </span>
                    </div>
                  </SelectItem>
                ))}
              </Select>

              <RadioGroup
                label="Schedule type"
                orientation="horizontal"
                value={form.type}
                onValueChange={(v) =>
                  setForm((f) => ({ ...f, type: v as BackgroundTaskType }))
                }
              >
                <Radio value="interval" description="Run every N (e.g. 30m, 1h)">
                  Interval
                </Radio>
                <Radio value="cron" description="Cron expression">
                  Cron
                </Radio>
                <Radio value="event" description="Triggered by a pod event">
                  Event
                </Radio>
              </RadioGroup>

              <Input
                label="Schedule"
                placeholder={placeholderForType(form.type)}
                value={form.schedule}
                onValueChange={(v) => setForm((f) => ({ ...f, schedule: v }))}
                description={
                  form.type === "event"
                    ? "Optional. Leave blank for one-shot dispatch."
                    : "Required for cron and interval types."
                }
              />

              <Textarea
                label="Description"
                placeholder="Optional — what this intent does"
                value={form.description}
                onValueChange={(v) => setForm((f) => ({ ...f, description: v }))}
                minRows={2}
              />

              <Textarea
                label="Prompt"
                placeholder="What should Hermes do? Stored in context.userPrompt."
                value={form.prompt}
                onValueChange={(v) => setForm((f) => ({ ...f, prompt: v }))}
                minRows={3}
              />
            </ModalBody>
            <ModalFooter>
              <Button variant="light" onPress={close} isDisabled={submitting}>
                Cancel
              </Button>
              <Button
                color="primary"
                onPress={() => void handleSubmit(close)}
                isLoading={submitting}
                isDisabled={!canSubmit}
              >
                {isEdit ? "Save" : "Create intent"}
              </Button>
            </ModalFooter>
          </>
        )}
      </ModalContent>
    </Modal>
  );
}
