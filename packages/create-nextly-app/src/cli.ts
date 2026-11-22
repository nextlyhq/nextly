#!/usr/bin/env node

import { buildProgram } from "./program";

// The program lives in program.ts so tests can run it without this entry.
void buildProgram().parseAsync();
