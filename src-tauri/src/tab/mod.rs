//! Reads Guitar Pro 7/8 (`.gp`) files into a [`model::Song`] for the in-app tab player.
//! Ported from the Tabline desktop app's `tabcore` crate (gp.rs, model.rs, tunings.rs).

pub mod gp;
pub mod model;
pub mod tunings;
