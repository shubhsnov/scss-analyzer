# Sass Analyzer

Sass Analyzer is project to make instrumentation around sass files easier in an editing environment.
Currently the analyzer can be used to pass valid scss text and get contexual hints as output. This output can be used
by an editor to provide code hinting.

## Getting Started

Create a sass file analyzer instance associated with some valid sass text
`var sassAnalyzer = new Analyzer(filepath, text);`

Following are the APIs that are meant to be used with the analyzer
```
var hints = sassAnalyzer.getAllHints();
var hints = sassAnalyzer.getAllGlobalHints();
var hints = sassAnalyzer.getHints("mixin"); //pass a type string
var hints = sassAnalyzer.getHints(["mixin", "imports", "variables"]); //pass an array of types
var hints = sassAnalyzer.getHintsForCursorPos(["variable", "import"], {line: 98, column: 22});
```

The analyzer is meant to be stateful, once text is passed, the analyzer gets associated 
with the text and analyzes the text based on the given type parametes.

The above APIs can be called more than one with the same or different type parameters

Also one a type has been queried, the results are cached and not computed again.
So if a user does getAllHints once, then he can hold the hint data as long as he holds a valid analyzer.

A reset API is also provided for helping in debugging various workflows, but functionally
is not necessary. It simply resets the cache and we can call getHints and getAllHints again
to recompute the hints.


## Built With

* [gonzales-pe](https://github.com/tonyganch/gonzales-pe) - CSS parser with support of preprocessors

## Authors

* **Shubham Yadav** - [shubhsnov](https://github.com/shubhsnov)

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details

