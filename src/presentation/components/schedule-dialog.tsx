'use client';

import * as React from 'react';
import {
  Type,
  ImageIcon,
  Video,
  Loader2,
  UploadCloud,
  Trash2,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Checkbox } from '@/components/ui/checkbox';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { SessionStatusBadge } from './session-status-badge';
import { useAlma } from '../providers/alma-provider';
import { cn } from '@/lib/utils';
import type { MediaAssetView, ScheduleView, TextStatusOptions } from '@/shared/view-models';

const BG_PRESETS = ['#0E7490', '#0D9488', '#4F46E5', '#B91C1C', '#B45309', '#065F46', '#1E293B', '#7C3AED'];
const TEXT_FONTS = 5;

interface FormState {
  title: string;
  contentType: 'text' | 'image' | 'video';
  text: string;
  textOptions: TextStatusOptions;
  media: MediaAssetView | null;
  caption: string;
  recurrenceKind: 'once' | 'daily' | 'weekly';
  date: string;
  time: string;
  daysOfWeek: number[];
  targetsMode: 'all' | 'select';
  selectedSessionIds: string[];
  enabled: boolean;
}

function todayIso(): string {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
}

function initialState(editing?: ScheduleView): FormState {
  const now = new Date();
  now.setHours(now.getHours() + 1, 0, 0, 0);
  return {
    title: editing?.title ?? '',
    contentType: editing?.content.type ?? 'text',
    text: editing?.content.text ?? '',
    textOptions: editing?.content.textOptions ?? { backgroundColor: '#0E7490', textColor: '#FFFFFF', fontIndex: 0 },
    media: null,
    caption: editing?.content.caption ?? '',
    recurrenceKind: editing?.recurrence.kind ?? 'once',
    date: editing?.runAt ? new Date(editing.runAt).toISOString().slice(0, 10) : todayIso(),
    time:
      editing?.recurrence.kind === 'once' && editing.runAt
        ? new Date(editing.runAt).toTimeString().slice(0, 5)
        : (editing?.timeOfDay && editing.timeOfDay !== '00:00' ? editing.timeOfDay : now.toTimeString().slice(0, 5)),
    daysOfWeek: editing?.recurrence.daysOfWeek ?? [],
    targetsMode: editing?.targets === 'all' || !editing ? 'all' : 'select',
    selectedSessionIds: Array.isArray(editing?.targets) ? editing.targets : [],
    enabled: editing?.enabled ?? true,
  };
}

const WEEKDAY_LABEL_KEYS = [
  'day.sunday',
  'day.monday',
  'day.tuesday',
  'day.wednesday',
  'day.thursday',
  'day.friday',
  'day.saturday',
];

export function ScheduleDialog({
  onOpenChange,
  editing,
}: {
  onOpenChange: (open: boolean) => void;
  editing?: ScheduleView;
}) {
  const { t, locale, sessions, actions, appInfo } = useAlma();
  const [form, setForm] = React.useState<FormState>(() => initialState(editing));
  const [step, setStep] = React.useState(0);
  const [fieldErrors, setFieldErrors] = React.useState<string[]>([]);
  const [submitting, setSubmitting] = React.useState(false);
  const [pickingMedia, setPickingMedia] = React.useState(false);
  const [dragActive, setDragActive] = React.useState(false);

  const patch = (partial: Partial<FormState>) => setForm((f) => ({ ...f, ...partial }));

  const usableSessions = sessions.filter((s) => s.status === 'connected' || s.status === 'disconnected');
  const hasConnected = sessions.some((s) => s.status === 'connected');

  const onDrop = React.useCallback(
    async (fileList: FileList | null) => {
      const file = fileList?.[0];
      if (!file) return;
      const filePath = window.alma?.getPathForFile(file);
      if (!filePath) return;
      const kind = form.contentType === 'image' ? 'image' : 'video';
      setPickingMedia(true);
      const asset = await actions.importDroppedFile(filePath, kind);
      setPickingMedia(false);
      if (asset) patch({ media: asset });
    },
    [actions, form.contentType],
  );

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
    void onDrop(e.dataTransfer.files);
  };

  const pickFile = async () => {
    setPickingMedia(true);
    const asset = await actions.pickMedia(form.contentType === 'image' ? 'image' : 'video');
    setPickingMedia(false);
    if (asset) patch({ media: asset });
  };

  const validateStep = (target: number): boolean => {
    const errors: string[] = [];
    if (target === 0) {
      if (!form.title.trim()) errors.push('TITLE_REQUIRED');
      if (form.contentType === 'text' && !form.text.trim()) errors.push('TEXT_REQUIRED');
      if (form.contentType !== 'text' && !form.media && !editing?.content.mediaId) errors.push('MEDIA_REQUIRED');
    }
    if (target === 1) {
      if (form.targetsMode === 'select' && form.selectedSessionIds.length === 0) errors.push('TARGETS_REQUIRED');
    }
    if (target === 2) {
      if (form.recurrenceKind === 'once' && !form.date) errors.push('RUN_AT_REQUIRED');
      if (form.recurrenceKind === 'weekly' && form.daysOfWeek.length === 0) errors.push('WEEKDAY_REQUIRED');
    }
    setFieldErrors(errors);
    return errors.length === 0;
  };

  const next = () => {
    if (validateStep(step)) setStep((s) => Math.min(s + 1, 2));
  };
  const back = () => setStep((s) => Math.max(s - 1, 0));

  const submit = async () => {
    for (const s of [0, 1, 2]) {
      if (!validateStep(s)) {
        setStep(s);
        return;
      }
    }
    setSubmitting(true);

    const runAt =
      form.recurrenceKind === 'once' ? new Date(`${form.date}T${form.time}:00`).getTime() : undefined;

    const input = {
      title: form.title,
      contentType: form.contentType,
      text: form.contentType === 'text' ? form.text : undefined,
      textOptions: form.contentType === 'text' ? form.textOptions : undefined,
      mediaId: form.contentType !== 'text' ? (form.media?.id ?? editing?.content.mediaId) : undefined,
      caption: form.contentType !== 'text' ? form.caption : undefined,
      recurrence:
        form.recurrenceKind === 'weekly'
          ? { kind: 'weekly' as const, daysOfWeek: form.daysOfWeek }
          : { kind: form.recurrenceKind },
      runAt,
      timeOfDay: form.time,
      targets: form.targetsMode === 'all' ? ('all' as const) : form.selectedSessionIds,
      enabled: form.enabled,
    };

    const result = editing
      ? await actions.updateSchedule(editing.id, input)
      : await actions.createSchedule(input);
    setSubmitting(false);
    if (result) onOpenChange(false);
  };

  const BackIcon = locale === 'ar' ? ChevronRight : ChevronLeft;
  const NextIcon = locale === 'ar' ? ChevronLeft : ChevronRight;

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>
            {editing ? t('scheduler.dialog.edit-title') : t('scheduler.dialog.create-title')}
          </DialogTitle>
          <DialogDescription>
            {step === 0
              ? t('scheduler.dialog.step-content')
              : step === 1
                ? t('scheduler.dialog.step-targets')
                : t('scheduler.dialog.step-timing')}
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="-mx-2 flex-1 px-2">
          <div className="flex flex-col gap-4 py-1">
            {fieldErrors.length > 0 && (
              <div className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {t('scheduler.validation.fix')}
              </div>
            )}

            {step === 0 && (
              <>
                <div className="grid gap-2">
                  <Label>{t('scheduler.dialog.title-label')}</Label>
                  <Input
                    value={form.title}
                    placeholder={t('scheduler.dialog.title-placeholder')}
                    onChange={(e) => patch({ title: e.target.value })}
                  />
                </div>

                <Tabs
                  value={form.contentType}
                  onValueChange={(v) => patch({ contentType: v as FormState['contentType'], media: null })}
                >
                  <TabsList className="grid w-full grid-cols-3">
                    <TabsTrigger value="text">
                      <Type className="me-1.5 size-4" />
                      {t('scheduler.dialog.tab-text')}
                    </TabsTrigger>
                    <TabsTrigger value="image">
                      <ImageIcon className="me-1.5 size-4" />
                      {t('scheduler.dialog.tab-image')}
                    </TabsTrigger>
                    <TabsTrigger value="video">
                      <Video className="me-1.5 size-4" />
                      {t('scheduler.dialog.tab-video')}
                    </TabsTrigger>
                  </TabsList>
                </Tabs>

                {form.contentType === 'text' && (
                  <div className="grid gap-3">
                    {/* live text-status preview */}
                    <div
                      className="flex min-h-28 items-center justify-center rounded-xl p-4 text-center text-lg font-semibold"
                      style={{ backgroundColor: form.textOptions.backgroundColor, color: form.textOptions.textColor }}
                    >
                      {form.text || t('scheduler.dialog.text-placeholder')}
                    </div>
                    <Textarea
                      value={form.text}
                      placeholder={t('scheduler.dialog.text-placeholder')}
                      className="min-h-24"
                      onChange={(e) => patch({ text: e.target.value })}
                    />
                    <div className="flex flex-wrap items-center gap-3">
                      <div className="flex items-center gap-1.5">
                        {BG_PRESETS.map((c) => (
                          <button
                            key={c}
                            type="button"
                            aria-label={`bg ${c}`}
                            onClick={() => patch({ textOptions: { ...form.textOptions, backgroundColor: c } })}
                            className={cn(
                              'size-6 rounded-full ring-2 ring-offset-2 ring-offset-background transition',
                              form.textOptions.backgroundColor === c ? 'ring-primary' : 'ring-transparent',
                            )}
                            style={{ backgroundColor: c }}
                          />
                        ))}
                      </div>
                      <div className="ms-auto flex items-center gap-2">
                        <Label className="text-xs text-muted-foreground">{t('scheduler.dialog.font')}</Label>
                        <Select
                          value={String(form.textOptions.fontIndex)}
                          onValueChange={(v) => patch({ textOptions: { ...form.textOptions, fontIndex: Number(v) } })}
                        >
                          <SelectTrigger className="h-8 w-20">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {Array.from({ length: TEXT_FONTS }, (_, i) => (
                              <SelectItem key={i} value={String(i)}>
                                {i + 1}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  </div>
                )}

                {form.contentType !== 'text' && (
                  <div className="grid gap-3">
                    {form.media || editing?.content.mediaId ? (
                      <div className="relative overflow-hidden rounded-xl border">
                        {(() => {
                          const previewUrl =
                            form.media?.previewUrl ??
                            (editing?.content.mediaId && appInfo
                              ? `${appInfo.mediaBaseUrl}/media/${editing.content.mediaId}`
                              : undefined);
                          return form.contentType === 'image' ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={previewUrl} alt={form.media?.fileName ?? editing?.content.caption ?? ''} className="max-h-56 w-full object-cover" />
                          ) : (
                            <video src={previewUrl} className="max-h-56 w-full" controls />
                          );
                        })()}
                        <div className="flex items-center justify-between px-3 py-2 text-xs text-muted-foreground">
                          <span className="truncate">{form.media?.fileName ?? t('common.of')}</span>
                          {form.media && (
                            <button
                              type="button"
                              onClick={() => patch({ media: null })}
                              className="text-destructive hover:underline"
                            >
                              <Trash2 className="size-3.5" />
                            </button>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div
                        onDragOver={(e) => {
                          e.preventDefault();
                          setDragActive(true);
                        }}
                        onDragLeave={() => setDragActive(false)}
                        onDrop={handleDrop}
                        className={cn(
                          'flex min-h-40 cursor-default flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-6 text-center transition',
                          dragActive && 'border-primary bg-primary/5',
                        )}
                      >
                        <UploadCloud className="size-8 text-muted-foreground" />
                        <div className="flex items-center gap-2">
                          <Button type="button" size="sm" variant="secondary" onClick={() => void pickFile()}>
                            {pickingMedia ? <Loader2 className="size-4 animate-spin" /> : form.contentType === 'image' ? (
                              <ImageIcon className="size-4" />
                            ) : (
                              <Video className="size-4" />
                            )}
                            {form.contentType === 'image' ? t('scheduler.dialog.choose-image') : t('scheduler.dialog.choose-video')}
                          </Button>
                        </div>
                        <p className="text-xs text-muted-foreground">{t('scheduler.dialog.drop-here')}</p>
                      </div>
                    )}
                    <Textarea
                      value={form.caption}
                      placeholder={t('scheduler.dialog.caption-placeholder')}
                      onChange={(e) => patch({ caption: e.target.value })}
                    />
                  </div>
                )}
              </>
            )}

            {step === 1 && (
              <>
                {!hasConnected && usableSessions.length === 0 && (
                  <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-sm text-amber-600 dark:text-amber-400">
                    {t('scheduler.dialog.no-sessions')}
                  </p>
                )}
                <RadioGroup
                  value={form.targetsMode}
                  onValueChange={(v) => patch({ targetsMode: v as 'all' | 'select' })}
                  className="gap-3"
                >
                  <label className="flex items-center gap-3 rounded-xl border p-3 text-sm font-medium has-[button[data-state=checked]]:border-primary">
                    <RadioGroupItem value="all" />
                    {t('scheduler.dialog.targets-all')}
                  </label>
                  <label className="flex items-center gap-3 rounded-xl border p-3 text-sm font-medium has-[button[data-state=checked]]:border-primary">
                    <RadioGroupItem value="select" />
                    {t('scheduler.dialog.targets-select')}
                  </label>
                </RadioGroup>

                {form.targetsMode === 'select' && (
                  <div className="grid gap-2">
                    {usableSessions.map((session) => (
                      <label
                        key={session.id}
                        className="flex items-center justify-between gap-3 rounded-xl border p-3"
                      >
                        <span className="flex items-center gap-3">
                          <Checkbox
                            checked={form.selectedSessionIds.includes(session.id)}
                            onCheckedChange={(checked) =>
                              patch({
                                selectedSessionIds: checked
                                  ? [...form.selectedSessionIds, session.id]
                                  : form.selectedSessionIds.filter((id) => id !== session.id),
                              })
                            }
                          />
                          <span className="text-sm font-medium">{session.name}</span>
                        </span>
                        <SessionStatusBadge status={session.status} />
                      </label>
                    ))}
                  </div>
                )}
              </>
            )}

            {step === 2 && (
              <>
                <div className="grid gap-2">
                  <Label>{t('scheduler.dialog.recurrence')}</Label>
                  <Tabs
                    value={form.recurrenceKind}
                    onValueChange={(v) => patch({ recurrenceKind: v as FormState['recurrenceKind'] })}
                  >
                    <TabsList className="grid w-full grid-cols-3">
                      <TabsTrigger value="once">{t('scheduler.dialog.once')}</TabsTrigger>
                      <TabsTrigger value="daily">{t('scheduler.dialog.daily')}</TabsTrigger>
                      <TabsTrigger value="weekly">{t('scheduler.dialog.weekly')}</TabsTrigger>
                    </TabsList>
                  </Tabs>
                </div>

                {form.recurrenceKind === 'once' && (
                  <div className="grid grid-cols-2 gap-3">
                    <div className="grid gap-2">
                      <Label>{t('scheduler.dialog.date')}</Label>
                      <Input type="date" value={form.date} min={todayIso()} onChange={(e) => patch({ date: e.target.value })} />
                    </div>
                    <div className="grid gap-2">
                      <Label>{t('scheduler.dialog.time')}</Label>
                      <Input type="time" value={form.time} onChange={(e) => patch({ time: e.target.value })} />
                    </div>
                  </div>
                )}

                {form.recurrenceKind !== 'once' && (
                  <div className="grid gap-2">
                    <Label>{t('scheduler.dialog.time')}</Label>
                    <Input type="time" value={form.time} onChange={(e) => patch({ time: e.target.value })} />
                  </div>
                )}

                {form.recurrenceKind === 'weekly' && (
                  <div className="grid gap-2">
                    <Label>{t('scheduler.dialog.days')}</Label>
                    <div className="flex flex-wrap gap-1.5">
                      {WEEKDAY_LABEL_KEYS.map((key, day) => {
                        const active = form.daysOfWeek.includes(day);
                        return (
                          <button
                            key={key}
                            type="button"
                            onClick={() =>
                              patch({
                                daysOfWeek: active
                                  ? form.daysOfWeek.filter((d) => d !== day)
                                  : [...form.daysOfWeek, day].sort(),
                              })
                            }
                            className={cn(
                              'rounded-full px-3 py-1.5 text-xs font-medium transition',
                              active ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground',
                            )}
                          >
                            {t(key)}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                <label className="flex items-center gap-3 rounded-xl border p-3 text-sm font-medium">
                  <Checkbox
                    checked={form.enabled}
                    onCheckedChange={(checked) => patch({ enabled: checked === true })}
                  />
                  {t('common.enabled')}
                </label>
              </>
            )}
          </div>
        </ScrollArea>

        <DialogFooter className="mt-2 flex-row items-center justify-between sm:justify-between">
          <Button variant="ghost" onClick={back} disabled={step === 0}>
            <BackIcon className="size-4" />
            {t('common.back')}
          </Button>
          {step < 2 ? (
            <Button onClick={next}>
              {t('common.next')}
              <NextIcon className="size-4" />
            </Button>
          ) : (
            <Button onClick={() => void submit()} disabled={submitting}>
              {submitting && <Loader2 className="size-4 animate-spin" />}
              {t('common.save')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
