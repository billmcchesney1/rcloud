Notebook.create_controller = function(model)
{
    var current_notebook;

    function append_cell_helper(content, type, id) {
        var cell_model = Notebook.Cell.create_model(content, type);
        var cell_controller = Notebook.Cell.create_controller(cell_model);
        cell_model.controller = cell_controller;
        return [cell_controller, model.append_cell(cell_model, id)];
    }

    function insert_cell_helper(content, type, id) {
        var cell_model = Notebook.Cell.create_model(content, type);
        var cell_controller = Notebook.Cell.create_controller(cell_model);
        cell_model.controller = cell_controller;
        return [cell_controller, model.insert_cell(cell_model, id)]
    }

    var result = {
        append_cell: function(content, type, id) {
            var cch = append_cell_helper(content, type, id);
            this.update_notebook(cch[1]);
            return cch[0];
        },
        insert_cell: function(content, type, id) {
            var cch = insert_cell_helper(content, type, id);
            this.update_notebook(cch[1]);
            return cch[0];
        },
        remove_cell: function(cell_model) {
            var changes = model.remove_cell(cell_model);
            this.update_notebook(changes);
        },
        clear: function() {
            model.clear();
        },
        load_notebook: function(user, notebook, k) {
            var that = this;
            current_notebook = notebook;
            rcloud.load_notebook(notebook, function(contents) {
                that.clear();
                var gist = JSON.parse(contents);
                var parts = {}; // could rely on alphabetic input instead of gathering
                _.each(gist.files, function (file) {
                    var filename = file.filename;
                    if(/^part/.test(filename)) {
                        var number = parseInt(filename.slice(4).split('.')[0]);
                        if(number !== NaN)
                            parts[number] = [file.content, file.language, number];
                    }
                    // style..
                });
                for(var i in parts)
                    append_cell_helper(parts[i][0], parts[i][1], parts[i][2]);
                k();
            });
        },
        update_notebook: function(changes) {
            function partname(id, language) {
                var ext;
                switch(language) {
                case 'R': 
                    ext = 'R';
                    break;
                case 'Markdown':
                    ext = 'md';
                    break;
                default:
                    throw "Unknown language " + language;
                }
                return 'part' + id + '.' + ext;
            }
            function changes_to_gist(changes) {
                // we don't use the gist rename feature because it doesn't
                // allow renaming x -> y and creating a new x at the same time
                // instead, create y and if there is no longer any x, erase it
                var post_names = _.reduce(changes, 
                                         function(names, change) {
                                             if(!change[1].erase) {
                                                 var after = change[1].rename || change[0];
                                                 names[partname(after, change[1].language)] = 1;
                                             }
                                             return names;
                                         }, {});
                function xlate_change(filehash, change) {
                    var c = {};
                    if(change[1].content !== undefined)
                        c.content = change[1].content;
                    var pre_name = partname(change[0], change[1].language);
                    if(change[1].erase || !post_names[pre_name])
                        filehash[pre_name] = null;
                    var post_name = partname(change[1].rename || change[0], change[1].language);
                    if(!change[1].erase)
                        filehash[post_name] = c;
                    return filehash;
                }
                return {files: _.reduce(changes, xlate_change, {})};
            }
            rcloud.update_notebook(current_notebook, changes_to_gist(changes), function(x) {});
        },
        run_all: function() {
            _.each(model.notebook, function(cell_model) {
                cell_model.controller.execute();
            });
        }
    };
    model.controller = result;
    return result;
};
