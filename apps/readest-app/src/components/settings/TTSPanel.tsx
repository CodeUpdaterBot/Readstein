import React, { useEffect, useState } from 'react';
import { useEnv } from '@/context/EnvContext';
import { useReaderStore } from '@/store/readerStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useResetViewSettings } from '@/hooks/useResetSettings';
import { useTranslation } from '@/hooks/useTranslation';
import { saveViewSettings } from '@/helpers/settings';
import { SettingsPanelPanelProp } from './SettingsDialog';
import {
  TTSEnginePreference,
  TTSHighlightGranularity,
  TTSMediaMetadataMode,
  TTSModelSize,
  TTSPlayerStyle,
  TTSStartPosition,
} from '@/services/tts/types';
import { getTTSCacheConfig, setTTSCacheConfig } from '@/services/tts/providers/bookCacheStore';
import { kokoroModelStore } from '@/services/tts/kokoro/modelStore';
import { isAndroidSherpaPlatform } from '@/services/tts/kokoro/sherpaPlatform';
import {
  formatPickerLabel,
  modelsGroupedByEngine,
  resolveOnDeviceModel,
} from '@/services/tts/onDeviceCatalog';
import { BoxedList, SettingsRow, SettingsSelect, SettingsSwitchRow } from './primitives';
import TTSHighlightStyleEditor, { TTSHighlightStyle } from './theme/TTSHighlightStyleEditor';

const TTSPanel: React.FC<SettingsPanelPanelProp> = ({ bookKey, onRegisterReset }) => {
  const _ = useTranslation();
  const { envConfig } = useEnv();
  const { getViewSettings } = useReaderStore();
  const { settings, setSettings, saveSettings } = useSettingsStore();
  const viewSettings = getViewSettings(bookKey) || settings.globalViewSettings;

  const [ttsEngine, setTtsEngine] = useState<TTSEnginePreference>(viewSettings.ttsEngine ?? 'auto');
  const [ttsModelSize, setTtsModelSize] = useState<TTSModelSize>(
    viewSettings.ttsModelSize ?? 'small',
  );
  const [ttsStartPosition, setTtsStartPosition] = useState<TTSStartPosition>(
    viewSettings.ttsStartPosition ?? 'visible-page',
  );
  const [ttsMediaMetadata, setTtsMediaMetadata] = useState<TTSMediaMetadataMode>(
    viewSettings.ttsMediaMetadata ?? 'sentence',
  );
  const [ttsPlayerStyle, setTtsPlayerStyle] = useState<TTSPlayerStyle>(
    viewSettings.ttsPlayerStyle ?? 'full',
  );
  const [ttsHighlightGranularity, setTtsHighlightGranularity] = useState<TTSHighlightGranularity>(
    viewSettings.ttsHighlightGranularity ?? 'word',
  );
  const [ttsHighlightStyle, setTtsHighlightStyle] = useState(
    viewSettings.ttsHighlightOptions.style,
  );
  const [ttsHighlightColor, setTtsHighlightColor] = useState(
    viewSettings.ttsHighlightOptions.color,
  );
  const [customTtsHighlightColors, setCustomTtsHighlightColors] = useState(
    settings.globalReadSettings.customTtsHighlightColors || [],
  );

  const [ttsCacheConfig, setTtsCacheConfigState] = useState(getTTSCacheConfig());
  const [kokoroState, setKokoroState] = useState(kokoroModelStore.getState());
  const [gpuPreview, setGpuPreview] = useState<{
    available: boolean;
    name: string;
    reason?: string;
  } | null>(null);

  const updateTTSCacheConfig = (config: typeof ttsCacheConfig) => {
    setTtsCacheConfigState(config);
    setTTSCacheConfig(config);
  };

  const resetToDefaults = useResetViewSettings();

  const handleReset = () => {
    resetToDefaults({
      ttsEngine: setTtsEngine as React.Dispatch<React.SetStateAction<string>>,
      ttsModelSize: setTtsModelSize as React.Dispatch<React.SetStateAction<string>>,
      ttsStartPosition: setTtsStartPosition as React.Dispatch<React.SetStateAction<string>>,
      ttsMediaMetadata: setTtsMediaMetadata as React.Dispatch<React.SetStateAction<string>>,
      ttsPlayerStyle: setTtsPlayerStyle as React.Dispatch<React.SetStateAction<string>>,
      ttsHighlightGranularity: setTtsHighlightGranularity as React.Dispatch<
        React.SetStateAction<string>
      >,
    });
  };

  useEffect(() => {
    onRegisterReset(handleReset);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => kokoroModelStore.subscribe(setKokoroState), []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { snapshotGpuAdapter, navigatorGpu } = await import(
        '@/services/tts/kokoro/discoverGpu'
      );
      const gpu = await snapshotGpuAdapter(navigatorGpu());
      if (!cancelled) {
        setGpuPreview({
          available: gpu.available,
          name: gpu.name,
          reason: gpu.reason,
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (ttsEngine === viewSettings.ttsEngine) return;
    saveViewSettings(envConfig, bookKey, 'ttsEngine', ttsEngine, false, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ttsEngine]);

  useEffect(() => {
    if (ttsModelSize === viewSettings.ttsModelSize) return;
    saveViewSettings(envConfig, bookKey, 'ttsModelSize', ttsModelSize, false, false);
    kokoroModelStore.setModelSize(ttsModelSize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ttsModelSize]);

  useEffect(() => {
    if (ttsStartPosition === viewSettings.ttsStartPosition) return;
    saveViewSettings(envConfig, bookKey, 'ttsStartPosition', ttsStartPosition, false, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ttsStartPosition]);

  useEffect(() => {
    if (ttsMediaMetadata === viewSettings.ttsMediaMetadata) return;
    saveViewSettings(envConfig, bookKey, 'ttsMediaMetadata', ttsMediaMetadata, false, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ttsMediaMetadata]);

  useEffect(() => {
    if (ttsPlayerStyle === viewSettings.ttsPlayerStyle) return;
    saveViewSettings(envConfig, bookKey, 'ttsPlayerStyle', ttsPlayerStyle, false, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ttsPlayerStyle]);

  useEffect(() => {
    if (ttsHighlightGranularity === viewSettings.ttsHighlightGranularity) return;
    saveViewSettings(
      envConfig,
      bookKey,
      'ttsHighlightGranularity',
      ttsHighlightGranularity,
      false,
      false,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ttsHighlightGranularity]);

  const handleTTSStyleChange = (style: TTSHighlightStyle) => {
    setTtsHighlightStyle(style);
    saveViewSettings(envConfig, bookKey, 'ttsHighlightOptions', {
      style,
      color: ttsHighlightColor,
    });
  };

  const handleTTSColorChange = (color: string) => {
    setTtsHighlightColor(color);
    saveViewSettings(envConfig, bookKey, 'ttsHighlightOptions', {
      style: ttsHighlightStyle,
      color,
    });
  };

  const handleCustomTtsColorsChange = (colors: string[]) => {
    setCustomTtsHighlightColors(colors);
    settings.globalReadSettings.customTtsHighlightColors = colors;
    setSettings(settings);
    saveSettings(envConfig, settings);
  };

  const showModelSize = ttsEngine === 'auto' || ttsEngine === 'kokoro';
  const accelerationLabel = (() => {
    if (kokoroState.loaded && kokoroState.device === 'webgpu') {
      return kokoroState.adapterName
        ? _('GPU · {{name}}', { name: kokoroState.adapterName })
        : _('GPU · WebGPU');
    }
    if (kokoroState.loaded && kokoroState.device === 'wasm') {
      if (kokoroState.gpuAvailable) {
        return _('CPU · WebGPU failed, using WASM');
      }
      return kokoroState.gpuReason
        ? _('CPU · {{reason}}', { reason: kokoroState.gpuReason })
        : _('CPU · WASM');
    }
    if (gpuPreview?.available && gpuPreview.name) {
      return _('GPU available · {{name}}', { name: gpuPreview.name });
    }
    if (gpuPreview?.reason) {
      return _('CPU · {{reason}}', { reason: gpuPreview.reason });
    }
    return _('Detecting GPU…');
  })();

  return (
    <div className='my-4 w-full space-y-6'>
      <BoxedList title={_('Voice Engine')} data-setting-id='settings.tts.engine'>
        <SettingsRow label={_('Engine')} data-setting-id='settings.tts.ttsEngine'>
          <SettingsSelect
            value={ttsEngine}
            onChange={(event) => setTtsEngine(event.target.value as TTSEnginePreference)}
            ariaLabel={_('Engine')}
            options={[
              { value: 'auto', label: _('Auto') },
              { value: 'kokoro', label: _('On-device') },
              { value: 'edge', label: _('Cloud') },
              { value: 'system', label: _('System') },
            ]}
          />
        </SettingsRow>
        {showModelSize && (
          <SettingsRow label={_('On-device Model')} data-setting-id='settings.tts.ttsModelSize'>
            <SettingsSelect
              value={resolveOnDeviceModel(ttsModelSize).id}
              onChange={(event) => setTtsModelSize(event.target.value as TTSModelSize)}
              ariaLabel={_('On-device Model')}
              groups={modelsGroupedByEngine().map((group) => ({
                label: _(group.engineLabel),
                options: group.models.map((model) => ({
                  value: model.id,
                  label: formatPickerLabel(model),
                })),
              }))}
            />
          </SettingsRow>
        )}
        {showModelSize && !isAndroidSherpaPlatform() && (
          <SettingsRow label={_('Acceleration')} data-setting-id='settings.tts.acceleration'>
            <span className='text-base-content/70 max-w-[16rem] truncate text-right text-sm'>
              {accelerationLabel}
            </span>
          </SettingsRow>
        )}
        <SettingsRow label={_('Start From')} data-setting-id='settings.tts.ttsStartPosition'>
          <SettingsSelect
            value={ttsStartPosition}
            onChange={(event) => setTtsStartPosition(event.target.value as TTSStartPosition)}
            ariaLabel={_('Start From')}
            options={[
              { value: 'visible-page', label: _('Visible page') },
              { value: 'resume', label: _('Resume last listen') },
            ]}
          />
        </SettingsRow>
      </BoxedList>

      <TTSHighlightStyleEditor
        granularity={ttsHighlightGranularity}
        style={ttsHighlightStyle}
        color={ttsHighlightColor}
        customColors={customTtsHighlightColors}
        onGranularityChange={setTtsHighlightGranularity}
        onStyleChange={handleTTSStyleChange}
        onColorChange={handleTTSColorChange}
        onCustomColorsChange={handleCustomTtsColorsChange}
        data-setting-id='settings.tts.ttsHighlightStyle'
      />

      <BoxedList title={_('Media Info')} data-setting-id='settings.tts.mediaMetadata'>
        <SettingsRow label={_('Player Style')} data-setting-id='settings.tts.playerStyle'>
          <SettingsSelect
            value={ttsPlayerStyle}
            onChange={(event) => setTtsPlayerStyle(event.target.value as TTSPlayerStyle)}
            ariaLabel={_('Player Style')}
            options={[
              { value: 'full', label: _('Full') },
              { value: 'minimal', label: _('Minimal') },
            ]}
          />
        </SettingsRow>
        <SettingsRow label={_('Update Frequency')}>
          <SettingsSelect
            value={ttsMediaMetadata}
            onChange={(event) => setTtsMediaMetadata(event.target.value as TTSMediaMetadataMode)}
            ariaLabel={_('Update Frequency')}
            options={[
              { value: 'sentence', label: _('Every Sentence') },
              { value: 'paragraph', label: _('Every Paragraph') },
              { value: 'chapter', label: _('Every Chapter') },
            ]}
          />
        </SettingsRow>
      </BoxedList>

      <BoxedList title={_('Audio Cache')} data-setting-id='settings.tts.audioCache'>
        <SettingsSwitchRow
          label={_('Cache Synthesized Audio')}
          description={_('Reuse generated speech across sessions without refetching')}
          checked={ttsCacheConfig.enabled}
          onChange={() =>
            updateTTSCacheConfig({ ...ttsCacheConfig, enabled: !ttsCacheConfig.enabled })
          }
          data-setting-id='settings.tts.audioCacheEnabled'
        />
        <SettingsSwitchRow
          label={_('Sync Audio Cache')}
          description={_('Share section audio between your devices through your file sync service')}
          checked={ttsCacheConfig.syncEnabled}
          disabled={!ttsCacheConfig.enabled}
          onChange={() =>
            updateTTSCacheConfig({ ...ttsCacheConfig, syncEnabled: !ttsCacheConfig.syncEnabled })
          }
          data-setting-id='settings.tts.audioCacheSync'
        />
        <SettingsRow label={_('Storage Limit')}>
          <SettingsSelect
            value={String(ttsCacheConfig.budgetMB)}
            onChange={(event) =>
              updateTTSCacheConfig({
                ...ttsCacheConfig,
                budgetMB: Number(event.target.value),
              })
            }
            ariaLabel={_('Storage Limit')}
            disabled={!ttsCacheConfig.enabled}
            options={[
              { value: '50', label: '50 MB' },
              { value: '100', label: '100 MB' },
              { value: '200', label: '200 MB' },
              { value: '500', label: '500 MB' },
              { value: '1024', label: '1 GB' },
            ]}
          />
        </SettingsRow>
      </BoxedList>
    </div>
  );
};

export default TTSPanel;
