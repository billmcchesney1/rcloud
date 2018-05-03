RCloud.UI.notebook_merge = (function() {
  const DialogStage = Object.freeze({
    INIT: 'init',
    GETTINGCHANGES: 'gettingchanges',
    COMPARE: 'compare'
  });

  const ChangeType = Object.freeze({
    NEWFILE: 'newfile', 
    DELETEDFILE: 'deletedfile',
    BINARY: 'binary',
    IDENTICAL: 'nochange',
    MODIFIED: 'changed'
  });

  const ChangedTypeDescription = Object.freeze({
    [ChangeType.NEWFILE]: 'Added file', 
    [ChangeType.DELETEDFILE]: 'Deleted file',
    [ChangeType.BINARY]: 'Binary',
    [ChangeType.IDENTICAL]: 'Identical',
    [ChangeType.MODIFIED]: 'Files are different'
  });

  const notebook_merge = class {
    constructor() {
      let that = this,
        _template = _.template($("#merger-template").html());

      this.diff_engine_ = new RCloud.UI.merging.diff_engine();

      this.templates_ = {
        file_list: _.template($('#compare-file-list-snippet').html()),
        compare_stage: _.template($('#compare-stage-snippet').html())
      };

      $("body").append(_template({}));
      this.dialog_ = $("#merger-dialog");
      this.select_by_ = $('#merge-changes-by');
      this.merge_notebook_file_ = $('#merge-notebook-file');
      this.merge_notebook_url_ = $('#merge-notebook-url');
      this.merge_notebook_id_ = $('#merge-notebook-id');

      this.compare_editor_selector_ = '#compare-editor';
      this.compare_result_selector_ = '#compare-result';

      this.previous_diff_button_ = $("#previous-diff");
      this.next_diff_button_ = $("#next-diff");
      this.error_selector_ = '#merge-error';

      this.merge_notebook_details_ = $('#merge-notebook-details');

      this.compare_file_list_ = $('#compare-file-list');
      this.compare_stage_ = $('#compare-stage');

      this.button_init_ = this.dialog_.find('.btn-init');
      
      this.btn_show_changes_ = this.dialog_.find('.btn-primary.btn-primary.show-changes');
      this.inputs_ = [this.merge_notebook_file_, this.merge_notebook_url_, this.merge_notebook_id_];
      this.notebook_from_file_;
      this.same_notebook_error_ = 'You cannot merge from your current notebook; the source must be a different notebook.';
      this.invalid_notebook_id_error_ = 'Invalid notebook ID.';
      this.not_found_notebook_error_ = 'The notebook could not be found.';

      this.diff_editor_ = null;
      this.diff_navigator_ = null;
      //this.result_editor_ = null;

      this.dialog_stage_ = DialogStage.INIT;
      this.notebook_description_;
      this.can_dispose_ = false;

      this.comparison_ = null;

      this.codelens_provider = null;

      $(this.dialog_).on('shown.bs.modal', () => {
        
      });

      $(this.dialog_).on('hidden.bs.modal', () => {
        this.clear();
      });

      $(this.dialog_).on('click', 'tbody tr:not(.selected)', (event) => {

        $(event.currentTarget).closest('table').find('tr').removeClass('selected');

        // for now, only comparison for 'common' files makes sense:
        this.set_model(
          _.findWhere(this.comparison_.from[$(event.currentTarget).data('filetype')], 
            { 'filename' : $(event.currentTarget).data('filename') }),
          _.findWhere(this.comparison_.to[$(event.currentTarget).data('filetype')], 
            { 'filename' : $(event.currentTarget).data('filename') })
        );
          
        $(event.currentTarget).addClass('selected');
      });

      this.previous_diff_button_.click(() => {
        this.diff_navigator_.previous();
      });

      this.next_diff_button_.click(() => {
        this.diff_navigator_.next();
      });

      this.select_by_.change(() => {
          this.merge_notebook_file_.val(null);
          this.update_merged_by(this.select_by_.val());
      });
      
      [this.merge_notebook_file_, this.merge_notebook_url_, this.merge_notebook_id_].forEach(function(control) {
        control.keydown((e) => {
          if(e.keyCode === $.ui.keyCode.ENTER) {
            this.do_get_changes();
            e.preventDefault();
          }
        });
      });

      this.btn_show_changes_.click(() => {
        this.do_get_changes();
      });

      this.button_init_.click(() => {
        this.update_stage(DialogStage.INIT);
      });

      RCloud.UI.advanced_menu.add({
        merge_notebook: {
          sort: 1100,
          text: "Merge notebook",
          modes: ["edit"],  
          disabled_reason: "You can't merge into a read only notebook",
          action: function() {

            rcloud.get_notebook_property(shell.gistname(), 'merge-changes-by').then(function(val) {
              if(val && val.indexOf(':') !== -1) {
                // split and set:
                var separatorIndex = val.indexOf(':');
                var type = val.substring(0, separatorIndex);
                var value = val.substring(separatorIndex + 1);

                // update merged by method:
                that.update_merged_by(type, value);
              }
              else {
                that.update_merged_by('url');
              }

              that.dialog_.modal({ keyboard: true });
            });
          }
        }
      });
    }
    update_merged_by(merged_method, value) {
      this.clear_error();
      this.select_by_.val(merged_method);
      $(this.dialog_).find('div[data-by]').hide();
      $(this.dialog_).find('div[data-by="' + merged_method + '"]').show();

      if(!_.isUndefined(value)) {
        // and set the value coming in:
        this.get_input().val(merged_method === 'file' ? '' : value);
      }
    }
    get_method() {
      return this.select_by_.val();
    }
    get_input() {
      return $('#merge-notebook-' + this.get_method());
    }
    clear_error() {
      $(this.error_selector_).remove();
    }
    show_error(errorText) {
      this.clear_error();
      $('<div />', {
        id: this.error_selector_.substring(1),
        text: errorText
      }).appendTo($(this.dialog_).find('div[data-by="' + this.get_method() + '"]'));
    }
    has_error() {
      return $(this.error_selector_).length;
    }
    do_get_changes() {

      // give the user the benefit of the doubt:
      this.clear_error();

      var get_notebook_by_id = (id) => {
        if(!Notebook.valid_gist_id(id)) {
          return Promise.reject(new Error(this.invalid_notebook_id_error_));
        } else if(id.toLowerCase() === shell.gistname().toLowerCase()) {
          return Promise.reject(new Error(this.same_notebook_error_));
        }
        return rcloud.get_notebook(id);
      };

      var method = this.get_method();

      var get_notebook_func, notebook;

      this.update_when_getting_changes();

      if(method === 'id') {
        get_notebook_func = get_notebook_by_id;
      } else if(method === 'file') {
          get_notebook_func = () => {
            if(notebook_from_file_) {
              return Promise.resolve(notebook_from_file_);
            } else {
              return Promise.reject(new Error('No file to upload'));
            }
          };
      } else if(method === 'url') {
        get_notebook_func = (url) => {
          var id = RCloud.utils.get_notebook_from_url(url);
          if(!id) {
            return Promise.reject(new Error('Invalid URL'));
          } else {
            return get_notebook_by_id(id);
          }
        };
      }
    
      var value = this.get_input().val();
      
      get_notebook_func.call(this, value).then((notebook) => {
        // return Promise.all([
        //   rcloud.set_notebook_property(shell.gistname(), 'merge-changes-by', method + ':' + value),
        //   editor.pull_and_replace_notebook(notebook).then(function() {
        //     clear();
        //     dialog_.modal('hide');
        //   })
        // ]);

        this.notebook_description_ = notebook.description;

        // current notebook:
        rcloud.set_notebook_property(shell.gistname(), 'merge-changes-by', method + ':' + value);

        // massage the returned notebook so that it's easier to work with:
        this.comparison_ = {
          from: this.prepare_notebook_for_comparison(shell.notebook.model.controller.current_gist()),
          to: this.prepare_notebook_for_comparison(notebook)
        };

        this.update_stage(DialogStage.COMPARE);

        this.update_compare_details(this.comparison_);

      }).catch((e) => {
        this.reset_getting_changes_state();
      
        if(e.message.indexOf('Not Found (404)') !== -1) {
          this.show_error(not_found_notebook_error_);
        } else {
          this.show_error(e.message);
          console.error(e);
        }
      });
    }
    update_stage(dialogStage) {
      if(dialogStage == DialogStage.INIT) {
        this.reset_getting_changes_state();
        this.button_init_.hide();
        this.can_dispose_ = false;
      }
      
      if(dialogStage == DialogStage.COMPARE) {
        this.merge_notebook_details_.html(`from ${this.notebook_description_}`);
        this.button_init_.show();
      } else {
        this.merge_notebook_details_.html('');
      }

      this.dialog_
        .removeClass(Object.keys(DialogStage).map(key => key.toLowerCase()).join(' '))
        .addClass(dialogStage.toLowerCase());
    }
    update_when_getting_changes() {
      this.btn_show_changes_.text('Getting changes');
      this.dialog_.addClass('gettingchanges');
    }
    reset_getting_changes_state() {
      this.btn_show_changes_.text('Show changes');
    }
    clear() {
      if(this.diff_editor_ && this.can_dispose_) {
        this.diff_editor_.dispose();
      }

      this.compare_file_list_.html('');

      $("#merge-container")
        .children()
        .remove();

      this.reset_getting_changes_state();

      this.inputs_.forEach((input) => {
          input.val('');
      });

      this.notebook_from_file_ = undefined;

      // default to URL for the next time:
      this.update_merged_by('url');

      this.update_stage(DialogStage.INIT);
    }
    prepare_notebook_for_comparison(notebook) {
      notebook.files = _.values(RCloud.utils.clean_r(notebook.files));
      notebook.parts = notebook.files.filter(f => Notebook.is_part_name(f.filename)).sort((p1, p2) => { 
        return p1.filename.localeCompare(p2.filename, undefined, { sensitivity: 'base' })
      });
      notebook.assets = notebook.files.filter(f => !Notebook.is_part_name(f.filename)).sort((a1, a2) => { 
        return a1.filename.localeCompare(a2.filename, undefined, { sensitivity: 'base' })
      });
      return notebook;
    }
    update_compare_details(comparison) {

      // from, to
      // assets, files
      comparison.fileDiffs = {
      };

      const sources = ['from', 'to'];

      const get_change_type = (filename, file_type) => {
        const from = _.findWhere(comparison.from[file_type], { filename }),
              to = _.findWhere(comparison.to[file_type], { filename });

        if(!from && to) {
          return ChangeType.NEWFILE;
        } else if(from && !to) {
          return ChangeType.DELETEDFILE;
        } else if(from.content.r_type) {
          return ChangeType.BINARY;
        } else {
          return from.content == to.content ? ChangeType.IDENTICAL : ChangeType.MODIFIED;
        }
      };

      // derive a list of all assets and parts:
      _.each(['assets', 'parts'], (file_type) => {
        comparison.fileDiffs['all' + file_type[0].toUpperCase() + file_type.substring(1)] = 
        _.map(
        _.sortBy(
        _.union(...
        _.map(sources, s => {
          return _.pluck(comparison[s][file_type], 'filename');
        })), f => { return file_type === 'assets' ? f : f.match(/\d+/).map(Number)[0]; }), filename => { 
          return {
            filename,
            change_type: get_change_type(filename, file_type),
            get change_type_desc() {
              return ChangedTypeDescription[this.change_type];
            }
          }; 
        });
      });

      this.compare_file_list_.html(this.templates_.file_list({
        comparison: comparison
      }));
      this.compare_stage_.html(this.templates_.compare_stage({

      }));
  
      //window.process.getuid = window.process.getuid || function() { return 0; };
      require(["vs/editor/editor.main"], () => {

        
        /*
        monaco.editor.defineTheme('theme', {
          base: 'vs',
          inherit: true,
          //rules: [{ background: '#eef3f7' }],
          colors: {
            'editor.background': '#eef3f7'
          }
        });

        monaco.editor.setTheme('theme');
        */

        

        monaco.languages.register({
          id: 'rcloud'
        });
       
        this.diff_editor_ = monaco.editor.create(
          $(this.compare_editor_selector_)[0],  
          {
            language: 'rcloud',
            fontSize: 11,
            scrollBeyondLastLine: false,
            minimap: {
              enabled: false
            }
          }
        );
      }); 
    }
    set_model(from, to) {

      $(this.compare_editor_selector_).show();
      
      const diff_info = this.diff_engine_.get_diff_info(from, to);

      this.diff_editor_.setValue(diff_info.content);

      if(this.codelens_provider)
        this.codelens_provider.dispose();

      // deleted, added
      this.diff_editor_.deltaDecorations([], _.map(diff_info.lineInfo, (li) => {
        return {
          range: new monaco.Range(li.startLine,1,li.endLine,1),
          options: {
            isWholeLine: true,
            className: li.diffType
          }
        } 
      }));

      const selectCurrentChanges = this.diff_editor_.addCommand(0,() => alert('accepting'), '');
      const rejectCurrentChanges = this.diff_editor_.addCommand(1,() => alert('rejecting'), ''); 

      this.codelens_provider = monaco.languages.registerCodeLensProvider('rcloud', {
        provideCodeLenses: function(model, token) {
            return _.flatten(_.map(diff_info.modifiedLineInfo, (li, index) => 
              [{
                range: { startLineNumber: li.startLine },
                id: 0,
                command: {
                    id: selectCurrentChanges,
                    title: 'Accept',
                },
              }, {
                range: { startLineNumber: li.startLine },
                id: 1,
                command: {
                    id: rejectCurrentChanges,
                    title: 'Reject',
                },
              }]))
        },
        resolveCodeLens: function(model, codeLens, token) {
            return codeLens;
          },
        },
      );

      this.can_dispose_ = true;

      console.log(this.diff_editor_);
    }
  };

  return {
      init: () => {
          return new notebook_merge();
      }
  };
})();