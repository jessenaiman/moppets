//! A character's airway size: one factor on the body's scale that lowers (bigger) or raises
//! (smaller) every resonance together, as a longer or shorter tube must, and a running voice
//! that still phonates across the whole allowed range. (Moved from the Moppets' old copy of
//! CHIMERA's engine: the size now lives here, on top of the pinned CHIMERA.)
use chimera::airway::frequency::{find_peaks, transfer_function};
use chimera::analysis::lpc::{FormantOpts, estimate_formants};
use chimera::anatomy::human::{BodyMix, HumanArtic, HumanBody, NEUTRAL};
use chimera::engine::Engine;
use moppet_wasm::{SCALE_RANGE, set_body_sized};
use chimera::phonetics::planner::vowel_artic;
use chimera::voice::human_airway::HumanAirway;
use chimera::voice::human_voice::SourcePatch;

fn airway_formants(vowel: &str, size: f64) -> Vec<f64> {
    let b = BodyMix::MALE;
    let a: HumanArtic = vowel_artic(vowel, b).unwrap().apply_to(&NEUTRAL);
    let mut w = HumanAirway::new(96000.0, HumanBody { scale: size, ..b.body() });
    w.apply(&a, 0.0);
    let el = w.net.linear_elements();
    let freqs: Vec<f64> = (0..480).map(|i| 60.0 * (8000.0f64 / 60.0).powf(i as f64 / 479.0)).collect();
    let h = transfer_function(&el, w.pharynx.first_node(), &freqs, &[w.glottis_port]);
    find_peaks(&freqs, &h.mag, 150.0).iter().map(|p| p.freq).take(3).collect()
}

#[test]
fn every_resonance_scales_inversely_with_size() {
    for v in ["a", "i", "u"] {
        let base = airway_formants(v, 1.0);
        for s in [SCALE_RANGE.0, 0.8, 1.2, SCALE_RANGE.1] {
            for (k, (f, f0)) in airway_formants(v, s).iter().zip(&base).enumerate() {
                let ratio = f / f0 * s;
                // within 15 %: a rounded /u/'s F1 drops a little less than the scale at the giant
                // end (×0.71 at 1.6), the lips' radiation not scaling exactly with the tube
                assert!((ratio - 1.0).abs() < 0.15, "/{v}/ size {s}: F{} {f:.0} against {f0:.0} (ratio×size {ratio:.2})", k + 1);
            }
        }
    }
}

/// Sing a held /a/ and return its median (F1, F2) and peak.
fn sung(body: BodyMix, size: f64, f0: f64) -> (f64, f64, f32) {
    let mut e = Engine::new(48000.0);
    set_body_sized(&mut e, body, size, 0.0);
    e.set_artic(&vowel_artic("a", body).unwrap(), None);
    e.set_source(&SourcePatch::f0(f0));
    e.set_gate(1.0);
    let mut out = vec![0.0f32; 48000];
    e.render(&mut out);
    assert!(out.iter().all(|x| x.is_finite()));
    let peak = out.iter().fold(0.0f32, |m, x| m.max(x.abs()));
    let y: Vec<f64> = out.chunks(4).map(|c| c.iter().map(|&v| v as f64).sum::<f64>() / 4.0).collect();
    let (mut f1, mut f2) = (vec![], vec![]);
    for st in (6000..y.len() - 360).step_by(180) {
        let fm = estimate_formants(&y[st..st + 360], 12000.0, FormantOpts { order: Some(14), ..Default::default() });
        if fm.len() >= 2 {
            f1.push(fm[0].freq);
            f2.push(fm[1].freq);
        }
    }
    f1.sort_by(|a, b| a.total_cmp(b));
    f2.sort_by(|a, b| a.total_cmp(b));
    (f1[f1.len() / 2], f2[f2.len() / 2], peak)
}

#[test]
fn a_sized_voice_still_sings_with_its_resonances_moved() {
    let (m1, m2, mp) = sung(BodyMix::MALE, 1.0, 110.0);
    let (g1, g2, gp) = sung(BodyMix::MALE, 1.4, 110.0); // a giant
    let (t1, t2, tp) = sung(BodyMix::CHILD, 0.88, 260.0); // the smallest allowed
    assert!(mp > 0.05 && gp > 0.05 && tp > 0.05, "peaks {mp} {gp} {tp}");
    assert!(g1 < m1 * 0.85 && g2 < m2 * 0.85, "giant F1 {g1:.0} F2 {g2:.0} against {m1:.0} {m2:.0}");
    assert!(t1 > m1 * 1.3 && t2 > m2 * 1.3, "tiny F1 {t1:.0} F2 {t2:.0} against {m1:.0} {m2:.0}");
}

#[test]
fn a_size_below_the_range_is_clamped_not_broken() {
    // a child body at half size would be 0.37 of the male: it sings at the smallest allowed scale
    let (a1, a2, _) = sung(BodyMix::CHILD, 0.5, 260.0);
    let (b1, b2, _) = sung(BodyMix::CHILD, SCALE_RANGE.0 / 0.74, 260.0);
    assert!((a1 - b1).abs() < 1.0 && (a2 - b2).abs() < 1.0, "{a1} {a2} against {b1} {b2}");
}

