// ============================================================================
// Virtual Laboratory — Line-by-Line Simulator (v3)
//
// The simulator deliberately does NOT follow the old sparse execution trace.
// Instead, every physical source-code line becomes one learner-controlled
// walkthrough step. Existing simulationData is used as semantic information
// where it exists; missing lines receive a deterministic explanation.
//
// Important distinction for students:
//   - WALKTHROUGH STEP = one source line in source order.
//   - SEMANTIC NOTE    = richer runtime information from the practical data.
// This keeps the visual flow continuous and prevents confusing jumps.
// ============================================================================
'use strict';

export class SimEngine {
  constructor(practical) {
    this.practical = practical || {};
    const sd = this.practical.simulationData || {};
    this.sourceLines = String(this.practical.sourceCode || '').replace(/\r\n?/g, '\n').split('\n');
    this.lang = this.practical.language || '';
    this.cells = Array.isArray(sd.cells) ? sd.cells : null;
    this.initial = this.clone(sd.initial && typeof sd.initial === 'object' ? sd.initial : {});
    this.finalOutput = sd.finalOutput || this.practical.expectedOutput || '';
    this.semanticSteps = Array.isArray(sd.steps) ? sd.steps : [];
    this.steps = this.buildWalkthrough();

    this.cursor = 0;
    this.status = 'ready'; // ready | running | paused | complete
    this.speed = 900;
    this.autoTimer = null;
    this.runToken = 0;
    this.listeners = [];
  }

  clone(value) {
    try { return JSON.parse(JSON.stringify(value)); }
    catch (_) { return value; }
  }

  get total() { return this.steps.length; }
  get done() { return this.cursor >= this.total; }
  get currentStep() { return this.cursor > 0 ? this.steps[this.cursor - 1] : null; }
  get nextStep() { return this.cursor < this.total ? this.steps[this.cursor] : null; }
  get autoRunning() { return this.status === 'running' && !!this.autoTimer; }

  on(callback) {
    if (typeof callback !== 'function') return () => {};
    this.listeners.push(callback);
    return () => { this.listeners = this.listeners.filter(fn => fn !== callback); };
  }

  emit() {
    this.listeners.slice().forEach(fn => {
      try { fn(this); } catch (error) { console.error('[simulator]', error); }
    });
  }

  // ------------------------------------------------------------------------
  // Build one stable step per source line.
  // ------------------------------------------------------------------------
  buildWalkthrough() {
    const byLine = new Map();
    this.semanticSteps.forEach((step, index) => {
      const line = Number(step?.line);
      if (!Number.isInteger(line) || line < 1 || line > this.sourceLines.length) return;
      const existing = byLine.get(line);
      // A source-line walkthrough visits each physical source line once. When
      // the original runtime trace contains the same line many times (for
      // example a scanner rule matching several tokens), keep the FIRST
      // occurrence for this source-line step. This makes the output panel
      // represent the earliest contribution made by that line instead of
      // jumping to a later loop iteration.
      if (!existing) {
        byLine.set(line, { step, index });
      }
    });

    let state = this.clone(this.initial);
    const steps = [];

    this.sourceLines.forEach((source, index) => {
      const line = index + 1;
      const semantic = byLine.get(line)?.step || null;
      const before = this.clone(state);
      let after = this.clone(state);

      if (semantic?.before && semantic?.after) {
        // Apply only actual changes recorded by the old runtime trace. This
        // avoids replacing the whole state with a snapshot from a different
        // execution branch and therefore avoids visible state teleportation.
        const keys = new Set([
          ...Object.keys(semantic.before || {}),
          ...Object.keys(semantic.after || {}),
        ]);
        keys.forEach(key => {
          if (!this.same(semantic.before?.[key], semantic.after?.[key])) {
            after[key] = this.clone(semantic.after[key]);
          }
        });
      }

      state = after;
      const explanation = semantic || this.explainLine(source, line, index);
      const isBlank = !source.trim();
      const isComment = /^\s*(\/\/|\/\*|\*|\*\/|#\s*\/\/)/.test(source);

      steps.push({
        id: line,
        line,
        source,
        before,
        after: this.clone(after),
        what: explanation.what,
        why: explanation.why,
        how: explanation.how,
        result: explanation.result,
        output: explanation.output || '',
        semantic: !!semantic,
        blank: isBlank,
        comment: isComment,
        runtimeNote: semantic ? 'This line has a detailed runtime note from the practical.' : 'This line is explained as part of the complete source walkthrough.',
      });
    });

    return steps;
  }

  quality(step) {
    if (!step) return 0;
    return ['what', 'why', 'how', 'result', 'before', 'after', 'output']
      .reduce((score, key) => score + (step[key] ? 1 : 0), 0);
  }

  same(a, b) {
    try { return JSON.stringify(a ?? null) === JSON.stringify(b ?? null); }
    catch (_) { return a === b; }
  }

  // ------------------------------------------------------------------------
  // Deterministic explanation fallback for lines that have no authored note.
  // ------------------------------------------------------------------------
  explainLine(source, line, index) {
    const s = source.trim();
    const lang = String(this.lang).toLowerCase();
    const prev = index > 0 ? this.sourceLines[index - 1].trim() : '';
    const next = index + 1 < this.sourceLines.length ? this.sourceLines[index + 1].trim() : '';

    if (!s) {
      return {
        what: 'This is a blank line used to separate logical parts of the program.',
        why: 'Blank lines improve readability. They do not execute any instruction.',
        how: 'The compiler, interpreter, LEX, or YACC generator skips the empty line.',
        result: 'No program state changes on this line.',
      };
    }

    if (/^(\/\/|\/\*|\*|\*\/)/.test(s)) {
      return {
        what: 'This line is a source-code comment.',
        why: 'Comments document the program for humans without becoming executable instructions.',
        how: 'The language tool ignores the comment while processing the program.',
        result: 'No runtime state changes; the explanation is for the student.',
      };
    }

    if (/^%\{/.test(s)) return this.simple('Opens the LEX/YACC C-code definitions block.', 'Declarations and header includes inside this block are copied into the generated C source.', 'The tool starts collecting the embedded C section until %} is reached.', 'The generated scanner/parser will receive the embedded declarations.');
    if (/^%\}/.test(s)) return this.simple('Closes the embedded C-code definitions block.', 'The tool must know where copied C declarations end.', 'Processing returns to the LEX/YACC specification.', 'The definitions section is complete.');
    if (/^%%/.test(s)) return this.simple('Marks a LEX/YACC section boundary.', 'LEX separates definitions, rules, and user code with %%.', 'The scanner/parser generator switches to the next section.', 'The next part of the specification can now be interpreted in its proper context.');
    if (/^#\s*include/.test(s)) return this.simple('Includes a standard C header file.', 'The program needs declarations supplied by that library, such as printf, strcpy, strlen, or FILE.', 'The preprocessor inserts the header declarations before compilation.', 'Required library declarations are available to the compiler.');
    if (/^#\s*define/.test(s)) return this.simple('Defines a C preprocessor macro.', 'A macro lets the programmer give a reusable name to a constant or code pattern.', 'The preprocessor substitutes the macro when compiling the source.', 'The macro is available to later source lines.');

    if (/^\s*(if|else\s+if|else)\b/.test(s)) return this.simple('Controls which branch of the program is executed.', 'A condition is needed so the program can choose the correct case for the current input or state.', 'The condition is evaluated and execution enters the matching block.', 'One branch becomes active; the other branch is skipped for this pass.');
    if (/^\s*(for|while|do)\b/.test(s)) return this.simple('Starts a loop.', 'The program must repeat an operation while a condition remains true or while input remains.', 'The loop condition controls whether the body executes again.', 'The program enters a repeatable execution block.');
    if (/^\s*switch\s*\(/.test(s)) return this.simple('Starts a switch selection statement.', 'Switch is useful when one expression can match several discrete cases.', 'The expression is evaluated and compared with the case labels.', 'Control will move to the matching case.');
    if (/^\s*(case|default)\b/.test(s)) return this.simple('Defines one branch of a switch statement.', 'Each case represents a possible value handled by the program.', 'If this case matches, its following statements execute until break or the switch ends.', 'This line identifies the selected case.');
    if (/^\s*break\s*;/.test(s)) return this.simple('Stops the current loop or switch case.', 'The program should leave the current repeated/selected block instead of continuing inside it.', 'Control jumps to the first statement after the loop or switch.', 'The current loop/case is terminated.');
    if (/^\s*continue\s*;/.test(s)) return this.simple('Skips to the next loop iteration.', 'The current iteration has no more work to perform.', 'Control returns to the loop condition/update.', 'The next iteration can begin.');
    if (/^\s*return\b/.test(s)) return this.simple('Returns a value or status from the current function.', 'Functions use return to send control, and sometimes a result, back to their caller.', 'The return expression is evaluated and the current function ends.', 'Control moves back to the calling function.');

    if (/\bprintf\s*\(/.test(s)) return this.simple('Produces console output using printf.', 'Output lets the user see the token, table entry, result, or status produced by the program.', 'printf formats its arguments and writes them to standard output.', 'The specified text/value is added to the program output.');
    if (/\b(scanf|fgets|getchar|gets)\s*\(/.test(s)) return this.simple('Reads input from the user or an input stream.', 'The program needs data before it can classify, parse, or process it.', 'The input function stores the received characters/value in the supplied variable or buffer.', 'The program now has input available for later processing.');
    if (/\bfopen\s*\(/.test(s)) return this.simple('Opens a file stream.', 'The practical reads its source/input from a file instead of only from the keyboard.', 'fopen connects the file name with a FILE pointer and the requested mode.', 'A file stream is ready for reading or writing.');
    if (/\bfclose\s*\(/.test(s)) return this.simple('Closes an opened file stream.', 'Closing a file releases its operating-system resources and flushes pending data.', 'The FILE stream is passed to fclose.', 'The file is safely closed.');
    if (/\b(yylex|yyparse|yywrap)\s*\(/.test(s)) return this.simple('Calls a LEX/YACC runtime function.', 'The generated scanner/parser performs the actual lexical or syntactic processing.', 'Control enters the generated function and returns after the requested processing completes.', 'The next part of the practical can continue with the returned result.');
    if (/\b(strcpy|strncpy|strcat|strlen|strstr|strchr|strcmp|strtok|memcpy)\s*\(/.test(s)) return this.simple('Performs a string-processing operation.', 'Compiler-lab programs frequently manipulate lexemes, grammar productions, tokens, or input buffers as strings.', 'The library function receives its arguments and returns or stores the requested string information.', 'The relevant string data is updated or inspected.');

    if (/^\s*[A-Za-z_][\w\[\]]*\s*=/.test(s) || /\+=|-=|\+\+|--/.test(s)) {
      return this.simple('Updates a program variable or data structure.', 'The program needs to store an intermediate value so later instructions can use it.', 'The right-hand side is evaluated and the resulting value is assigned or applied to the variable.', 'The tracked program state changes for this line.');
    }

    if (/\b(int|float|double|char|void|long|short|FILE|struct)\b/.test(s) && /[;{]/.test(s)) {
      return this.simple('Declares a variable, data structure, or function-related type.', 'The compiler needs to know the name, type, and memory representation before the value is used.', 'The declaration introduces the identifier into the current scope.', 'The program now has the declared item available.');
    }

    if (/^[A-Za-z_][\w\s\*]*\([^;]*\)\s*\{?$/.test(s)) {
      return this.simple('Defines or begins a function.', 'Functions divide the practical into logical operations that can be called when needed.', 'The function name, parameters, return type, and body establish its execution boundary.', 'A callable program operation is defined.');
    }

    if (/^\s*[{}]\s*$/.test(s)) {
      return this.simple('Opens or closes a block of code.', 'Blocks group statements that belong to a function, condition, loop, or rule action.', 'The opening brace starts a scope and the closing brace ends it.', 'Control-flow scope is clearly delimited.');
    }

    if (lang.includes('yacc') || lang.includes('bison')) {
      return this.simple('Defines part of the grammar or parser specification.', 'YACC/Bison uses grammar productions to describe which token sequences form valid syntax.', 'The parser generator records this production while building the parsing tables.', 'This grammar information becomes part of the generated parser.');
    }

    if (lang.includes('lex') || lang.includes('flex')) {
      return this.simple('Defines part of the lexical specification.', 'LEX/Flex needs patterns and actions to convert characters into meaningful tokens.', 'The scanner generator records this line as part of the specification.', 'The rule/definition contributes to the generated lexical analyzer.');
    }

    return this.simple('Processes this source-code statement.', 'Every statement contributes a small part of the practical algorithm.', 'The compiler or tool processes the statement in the context created by earlier lines.', 'The program moves one line closer to completing the practical.');
  }

  simple(what, why, how, result) { return { what, why, how, result, output: '' }; }

  // ------------------------------------------------------------------------
  // Controls — exactly one cursor mutation per user action.
  // ------------------------------------------------------------------------
  next() {
    this.cancelAuto(false);
    if (this.done) return false;
    this.cursor += 1;
    this.status = this.done ? 'complete' : 'paused';
    this.emit();
    return true;
  }

  prev() {
    this.cancelAuto(false);
    if (this.cursor <= 0) return false;
    this.cursor -= 1;
    this.status = this.cursor === 0 ? 'ready' : 'paused';
    this.emit();
    return true;
  }

  restart() {
    this.cancelAuto(false);
    this.cursor = 0;
    this.status = 'ready';
    this.emit();
  }

  finish() {
    this.cancelAuto(false);
    this.cursor = this.total;
    this.status = 'complete';
    this.emit();
  }

  jump(step) {
    this.cancelAuto(false);
    const target = Math.max(0, Math.min(this.total, Number(step) || 0));
    this.cursor = target;
    this.status = this.cursor === 0 ? 'ready' : this.done ? 'complete' : 'paused';
    this.emit();
  }

  play() {
    if (this.total === 0 || this.autoRunning) return;
    if (this.done) this.cursor = 0;
    this.status = 'running';
    const token = ++this.runToken;
    const tick = () => {
      if (token !== this.runToken || this.status !== 'running') return;
      if (this.cursor >= this.total) {
        this.autoTimer = null;
        this.status = 'complete';
        this.emit();
        return;
      }
      this.cursor += 1;
      if (this.cursor >= this.total) {
        this.autoTimer = null;
        this.status = 'complete';
        this.emit();
        return;
      }
      this.emit();
      this.autoTimer = setTimeout(tick, this.speed);
    };
    this.autoTimer = setTimeout(tick, this.speed);
    this.emit();
  }

  pause() {
    if (!this.autoRunning) return;
    this.cancelAuto(false);
    this.status = this.done ? 'complete' : 'paused';
    this.emit();
  }

  cancelAuto(emit = true) {
    this.runToken += 1;
    if (this.autoTimer) clearTimeout(this.autoTimer);
    this.autoTimer = null;
    if (emit) this.emit();
  }

  setSpeed(ms) {
    const value = Number(ms);
    if (!Number.isFinite(value)) return;
    this.speed = Math.max(250, Math.min(4000, Math.round(value)));
    if (this.autoRunning) {
      this.pause();
      this.play();
    }
  }

  stateNow() {
    if (this.cursor === 0) return this.clone(this.initial);
    return this.clone(this.steps[this.cursor - 1]?.after || this.initial);
  }

  changedKeys() {
    const step = this.currentStep;
    if (!step) return [];
    const keys = new Set([...Object.keys(step.before || {}), ...Object.keys(step.after || {})]);
    return [...keys].filter(key => !this.same(step.before?.[key], step.after?.[key]));
  }

  normalizeOutput(text) {
    return String(text ?? '')
      .replace(/\[space\]/g, ' ')
      .replace(/\[newline\]/g, '\n')
      .replace(/\\n/g, '\n')
      .replace(/\\t/g, '\t');
  }

  outputSoFar() {
    return this.steps.slice(0, this.cursor)
      .map(step => this.normalizeOutput(step.output || ''))
      .filter(Boolean)
      .join('');
  }

  outputLines() {
    return this.steps.slice(0, this.cursor).map(step => ({
      step: step.id,
      line: step.line,
      text: step.output || '',
      hasOutput: !!String(step.output || '').trim(),
    })).filter(item => item.hasOutput);
  }

  lineState(lineNo) {
    if (this.currentStep?.line === lineNo) return 'current';
    if (this.nextStep?.line === lineNo) return 'next';
    if (lineNo <= this.cursor) return 'done';
    return 'todo';
  }
}
