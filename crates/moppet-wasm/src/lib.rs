//! The Moppets' engine build. CHIMERA is a dependency, pinned in `chimera/` and never edited:
//! this module links CHIMERA's whole C ABI unchanged (`chimera_wasm`: the JSON calls, planning,
//! the beatbox, creatures) and adds what is Moppet-only:
//!
//! - **An airway of any size.** A Moppet is a body (male, female, child) at a size: Gruff and
//!   Clank are giants (×1.5), Pip and Chip small. Every length and area of the airway and the glottis
//!   follows one scale, so every resonance moves together ([`sized_anatomy`]).
//! - **`moppet_*`**: a voice handle like CHIMERA's `engine_*` one (same records, value area and
//!   telemetry block), whose body call takes the size. CHIMERA's handle keeps its engine private,
//!   so a sized voice needs its own; the engine itself is CHIMERA's (`Engine::voice_mut`).
//!
//! The contract is CHIMERA's (`chimera/docs/rust-engine.md`): no allocation while rendering, output
//! independent of block size. A body or size change allocates (a new airway network).

use chimera::anatomy::human::{ArticPatch, BodyMix, HumanBody, N_ARTIC};
use chimera::control::score::Gesture;
use chimera::engine::{Engine, MAX_SCHEDULE};
use chimera::voice::human_voice::{HumanVoice, SourcePatch, VoiceTelemetry, oversample_for};
pub use chimera_wasm::{GESTURE_RECORD, MAX_RENDER, TELE_HEADER, read_gesture};

/// Smallest and largest airway a Moppet may have, as its overall scale against the adult male
/// (body scale × size): the human bodies span 0.74 (child) to 1; a cartoon cast needs more. Below
/// about 0.65 the running voice stops phonating cleanly (the static airway still resonates right,
/// the folds don't), so the scale is clamped here, whatever the body.
pub const SCALE_RANGE: (f64, f64) = (0.65, 1.6);

/// A body's anatomy at a Moppet's size; at 1 exactly CHIMERA's calibrated body.
pub fn sized_anatomy(body: BodyMix, size: f64) -> HumanBody {
    let anatomy = body.body();
    if size == 1.0 || !size.is_finite() || size <= 0.0 {
        return anatomy;
    }
    HumanBody { scale: chimera::math::clamp(anatomy.scale * size, SCALE_RANGE.0, SCALE_RANGE.1), ..anatomy }
}

/// Switch `e` to `body` at `size`, as CHIMERA's `set_body` does (it carries the source, posture and
/// breath over; pitch resets to the body's default): a giant sings the notes it is given.
pub fn set_body_sized(e: &mut Engine, body: BodyMix, size: f64, gate: f64) {
    e.set_body(body);
    let size = if size.is_finite() && size > 0.0 { size } else { 1.0 };
    if size == 1.0 {
        return;
    }
    let fs = e.sample_rate;
    let prev = core::mem::replace(e.voice_mut(), HumanVoice::new(fs, sized_anatomy(body, size), oversample_for(fs)));
    let v = e.voice_mut();
    v.set_source(&SourcePatch::from_source(&prev.source));
    let mut target = ArticPatch::default();
    for (k, x) in prev.artic.target.to_array().iter().enumerate() {
        target.values[k] = Some(*x);
    }
    v.set_articulation(&target, Some(prev.artic.tip_free));
    e.set_gate(gate);
}

// ------------------------------------------------------------------ the Moppet voice handle

/// A sized voice and the buffers JavaScript reads and writes (laid out as CHIMERA's `Handle`).
pub struct MoppetHandle {
    engine: Engine,
    gate: f64,
    out: Vec<f32>,
    records: Vec<u8>,
    gestures: Vec<Gesture>,
    values: Vec<f64>,
    tele: VoiceTelemetry,
    tele_block: Vec<f64>,
    tele_labels: Vec<u8>,
}

fn opt(x: f64) -> Option<f64> {
    if x.is_nan() { None } else { Some(x) }
}

macro_rules! handle {
    ($h:expr) => {
        unsafe { &mut *$h }
    };
}

/// Lead time CHIMERA inserts between starting its beat sequencer and beat zero.
#[unsafe(no_mangle)]
pub extern "C" fn moppet_beat_preroll_seconds() -> f64 {
    chimera::control::beat_player::BeatPlayer::HORIZON
}

/// Schedule the step in the first beat-record slot on the absolute performance clock.
///
/// # Safety
/// `h` must be a live Moppet handle with a step written into its record buffer.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn moppet_beat_hit_at(h: *mut MoppetHandle, seconds: f64, length: f64) {
    let h = handle!(h);
    if let Some(step) = chimera_wasm::read_step(&h.records[..chimera_wasm::STEP_RECORD]) {
        h.engine.beat_hit_at(&step, seconds, length, None);
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn moppet_new(sample_rate: f64) -> *mut MoppetHandle {
    let mut h = Box::new(MoppetHandle {
        engine: Engine::new(sample_rate),
        gate: 0.0,
        out: vec![0.0; MAX_RENDER],
        records: vec![0u8; MAX_SCHEDULE * GESTURE_RECORD],
        gestures: Vec::with_capacity(MAX_SCHEDULE),
        values: vec![f64::NAN; 32],
        tele: VoiceTelemetry::default(),
        tele_block: Vec::with_capacity(TELE_HEADER + 1024),
        tele_labels: vec![0u8; 4 * 25],
    });
    h.engine.telemetry(&mut h.tele);
    Box::into_raw(h)
}

/// # Safety
/// `h` must come from `moppet_new` and not be used afterwards.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn moppet_free(h: *mut MoppetHandle) {
    if !h.is_null() {
        drop(unsafe { Box::from_raw(h) });
    }
}

/// Render `n` (≤ MAX_RENDER) frames; returns the output buffer's address.
///
/// # Safety
/// `h` must be a live handle.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn moppet_render(h: *mut MoppetHandle, n: usize) -> *const f32 {
    let h = handle!(h);
    let n = n.min(MAX_RENDER);
    h.engine.render(&mut h.out[..n]);
    h.out.as_ptr()
}

/// The record area JavaScript fills before `moppet_schedule` (MAX_SCHEDULE gesture records).
///
/// # Safety
/// `h` must be a live handle.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn moppet_records(h: *mut MoppetHandle) -> *mut u8 {
    handle!(h).records.as_mut_ptr()
}

/// Schedule `count` records, times relative to now + `lead`; returns the plan's time 0 on the clock.
///
/// # Safety
/// `h` must be a live handle.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn moppet_schedule(h: *mut MoppetHandle, count: usize, lead: f64, replace: u32) -> f64 {
    let h = handle!(h);
    let count = count.min(MAX_SCHEDULE);
    h.gestures.clear();
    for i in 0..count {
        h.gestures.push(read_gesture(&h.records[i * GESTURE_RECORD..(i + 1) * GESTURE_RECORD]));
    }
    h.engine.schedule(&h.gestures, lead, replace != 0)
}

/// A scratch array of 32 f64 for value-carrying calls (artic and source patches).
///
/// # Safety
/// `h` must be a live handle.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn moppet_values(h: *mut MoppetHandle) -> *mut f64 {
    handle!(h).values.as_mut_ptr()
}

/// The articulation in the value area (N_ARTIC values in ArticKey order, NaN: unchanged).
/// `tip_free`: 0 false, 1 true, anything else unchanged.
///
/// # Safety
/// `h` must be a live handle.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn moppet_set_artic(h: *mut MoppetHandle, tip_free: u32) {
    let h = handle!(h);
    let mut p = ArticPatch::default();
    for k in 0..N_ARTIC {
        p.values[k] = opt(h.values[k]);
    }
    h.engine.set_artic(&p, if tip_free < 2 { Some(tip_free == 1) } else { None });
}

/// Source values in the value area, in CHIMERA's order (NaN: unchanged): f0, glide, pressure,
/// breathiness, tension, fry, roughness, vibratoDepth, vibratoRate, drift, voiced (0/1), brightness.
///
/// # Safety
/// `h` must be a live handle.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn moppet_set_source(h: *mut MoppetHandle) {
    let h = handle!(h);
    let v = &h.values;
    let p = SourcePatch {
        f0: opt(v[0]),
        glide: opt(v[1]),
        pressure: opt(v[2]),
        breathiness: opt(v[3]),
        tension: opt(v[4]),
        fry: opt(v[5]),
        roughness: opt(v[6]),
        vibrato_depth: opt(v[7]),
        vibrato_rate: opt(v[8]),
        drift: opt(v[9]),
        voiced: opt(v[10]).map(|x| x != 0.0),
        brightness: opt(v[11]),
    };
    h.engine.set_source(&p);
}

/// # Safety
/// `h` must be a live handle.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn moppet_set_gate(h: *mut MoppetHandle, level: f64) {
    let h = handle!(h);
    h.gate = level;
    h.engine.set_gate(level);
}

/// The Moppet's body (`female`, `child` 0…1, as CHIMERA's `BodyMix`) at `size` (1: the body as
/// calibrated; the overall scale is clamped to [`SCALE_RANGE`]). Allocates.
///
/// # Safety
/// `h` must be a live handle.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn moppet_set_body(h: *mut MoppetHandle, female: f64, child: f64, size: f64) {
    let h = handle!(h);
    set_body_sized(&mut h.engine, BodyMix::new(female, child), size, h.gate);
    h.engine.telemetry(&mut h.tele); // a resized airway has a different number of sections
}

/// # Safety
/// `h` must be a live handle.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn moppet_stop_speech(h: *mut MoppetHandle) {
    handle!(h).engine.stop_speech();
}

/// # Safety
/// `h` must be a live handle.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn moppet_release(h: *mut MoppetHandle, tag: f64) {
    handle!(h).engine.release(tag);
}

/// # Safety
/// `h` must be a live handle.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn moppet_clock(h: *mut MoppetHandle) -> f64 {
    handle!(h).engine.clock()
}

/// A telemetry snapshot in CHIMERA's flat block layout (see `chimera_wasm::engine_telemetry`).
///
/// # Safety
/// `h` must be a live handle.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn moppet_telemetry(h: *mut MoppetHandle) -> *const f64 {
    let h = handle!(h);
    h.engine.telemetry(&mut h.tele);
    let t = &h.tele;
    let b = &mut h.tele_block;
    b.clear();
    b.extend_from_slice(&[t.ph_len, t.or_len, t.velum_port, t.f0, t.voicing, t.p_lung, t.out_rms, t.noise_level, t.noise_node as f64, t.gate, t.clock]);
    b.extend_from_slice(&[t.artic.len() as f64, t.ph_areas.len() as f64, t.or_areas.len() as f64, t.glottal_area.len() as f64, t.active.len() as f64]);
    for arr in [&t.artic, &t.ph_areas, &t.or_areas, &t.pressure_rms, &t.flow, &t.glottal_area, &t.glottal_flow] {
        b.extend(arr.iter().map(|x| *x as f64));
    }
    for (i, l) in t.active.iter().enumerate() {
        let bytes = l.as_bytes();
        h.tele_labels[i * 25] = bytes.len() as u8;
        h.tele_labels[i * 25 + 1..i * 25 + 1 + bytes.len()].copy_from_slice(bytes);
    }
    b.as_ptr()
}

/// The active-label area of the last telemetry snapshot: up to 4 × (length byte, 24 bytes).
///
/// # Safety
/// `h` must be a live handle.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn moppet_tele_labels(h: *mut MoppetHandle) -> *const u8 {
    handle!(h).tele_labels.as_ptr()
}
